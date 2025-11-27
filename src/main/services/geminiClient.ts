import { GoogleGenerativeAI, Content, Part, GenerativeModel } from '@google/generative-ai';
import { IModelClient, ComputerUseRequest, ComputerUseResponse, StreamEvent } from './modelClient';
import Anthropic from '@anthropic-ai/sdk';

export class GeminiModelClient implements IModelClient {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private modelName: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.client = new GoogleGenerativeAI(cfg.apiKey);
    this.modelName = cfg.model;
    this.model = this.client.getGenerativeModel({ 
      model: this.modelName,
      tools: [
        {
          functionDeclarations: [
            {
              name: 'computer',
              description: 'Use a computer to achieve the goal.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  action: {
                    type: 'STRING',
                    description: 'The action to perform (key, type, mouse_move, left_click, etc).',
                    enum: [
                      'key',
                      'type',
                      'mouse_move',
                      'left_click',
                      'left_click_drag',
                      'right_click',
                      'middle_click',
                      'double_click',
                      'screenshot',
                      'cursor_position',
                    ],
                  },
                  coordinate: {
                    type: 'ARRAY',
                    description: '(x, y): The x and y coordinates to move the mouse to. Required for `mouse_move`, `left_click`, `right_click`, `middle_click`, `double_click`, `left_click_drag` (to), and `cursor_position` (to).',
                    items: {
                      type: 'INTEGER',
                    },
                  },
                  text: {
                    type: 'STRING',
                    description: 'The text to type. Required for `type` and `key`.',
                  },
                },
                required: ['action'],
              },
            },
            {
              name: 'ask_user',
              description: 'Ask the user for clarity or additional information if you are stuck or need more details to complete the task.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  question: {
                    type: 'STRING',
                    description: 'The question to ask the user',
                  },
                },
                required: ['question'],
              },
            }
          ]
        }
      ]
    });
  }

  private mapAnthropicToGemini(messages: Anthropic.MessageParam[]): Content[] {
    const contents: Content[] = [];

    for (const msg of messages) {
      const parts: Part[] = [];
      
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'image') {
            if (block.source.type === 'base64') {
              parts.push({
                inlineData: {
                  mimeType: block.source.media_type,
                  data: block.source.data,
                },
              });
            }
          } else if (block.type === 'tool_use') {
            parts.push({
              functionCall: {
                name: block.name,
                args: block.input as Record<string, any>,
              },
            });
          } else if (block.type === 'tool_result') {
            // tool_result needs to be mapped to a separate functionResponse part
            // AND it needs to be in a 'function' role message or similar? 
            // Gemini expects 'function' role for function responses or 'user' role with functionResponse parts?
            // Actually, in Gemini 'user' role sends functionResponse.
            
            // Handle content of tool result
            let responseContent = {};
            if (typeof block.content === 'string') {
               responseContent = { output: block.content };
            } else if (Array.isArray(block.content)) {
               // If there are images in tool result, they usually go as separate parts or we just send text?
               // Gemini functionResponse args are object. We might need to simplify.
               // For screenshot tool, we usually return "screenshot_taken" text and the image is sent in the *next* user message?
               // Or can functionResponse contain image?
               // The harness logic sends image in the NEXT user message usually.
               
               // Let's look at how the agent loop works. 
               // The agent loop creates a user message with tool_results.
               // For Gemini, we map tool_result to functionResponse.
               
               const textPart = block.content.find(c => c.type === 'text');
               const imagePart = block.content.find(c => c.type === 'image');
               
               responseContent = { 
                 output: textPart?.type === 'text' ? textPart.text : '',
                 // We can't easily put the image inside the functionResponse in Gemini API typically.
                 // Usually we send the image as a separate 'user' part or in the next turn.
                 // But wait, the harness sends `tool_results` which contains both.
               };
               
               // If there is an image, we should add it as a separate part in the same message if possible
               if (imagePart?.type === 'image' && imagePart.source.type === 'base64') {
                  // This is tricky. Gemini expects functionResponse to just be the result object.
                  // Images are usually sent as 'user' parts.
                  // We might need to split this into functionResponse part AND image part.
               }
            }

            parts.push({
              functionResponse: {
                name: 'computer', // We assume it's computer tool for now, or match ID?
                response: { result: responseContent }
              }
            });
          }
        }
      }

      // Gemini roles: 'user' or 'model'. Anthropic: 'user' or 'assistant'.
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts });
    }

    return contents;
  }

  async computerUseStream(
    request: ComputerUseRequest,
    onEvent?: (event: StreamEvent) => void
  ): Promise<ComputerUseResponse> {
    
    // We need to construct the full history including the system prompt?
    // Gemini allows systemInstruction at model init or generate call.
    // We'll use systemInstruction in generate call if supported, or prepend to history.
    
    // Convert messages
    const contents = this.mapAnthropicToGemini(request.messages);
    
    // Convert system prompt
    let systemInstruction = undefined;
    if (request.systemPrompt) {
      systemInstruction = {
        parts: [{ text: request.systemPrompt }]
      };
    }

    try {
      const result = await this.model.generateContentStream({
        contents,
        systemInstruction,
      });

      let accumulatedText = '';
      const finalContent: Anthropic.ContentBlock[] = [];

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          accumulatedText += text;
          onEvent?.({ type: 'text_delta', text });
        }
        
        // Check for function calls
        const calls = chunk.functionCalls();
        if (calls) {
          for (const call of calls) {
             const toolUseId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
             onEvent?.({ type: 'tool_use_start', id: toolUseId, name: call.name });
             
             finalContent.push({
               type: 'tool_use',
               id: toolUseId,
               name: call.name,
               input: call.args
             });
          }
        }
      }

      if (accumulatedText) {
        finalContent.unshift({
          type: 'text',
          text: accumulatedText
        });
      }

      return {
        content: finalContent,
        stopReason: 'end_turn', // simplified
        usage: {
            inputTokens: 0, // Not always available in stream
            outputTokens: 0
        }
      };

    } catch (error) {
      console.error('Gemini API Error:', error);
      throw error;
    }
  }
}

