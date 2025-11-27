import { GoogleGenerativeAI, Content, Part, GenerativeModel, SchemaType, Schema, FunctionDeclarationSchema } from '@google/generative-ai';
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
                type: SchemaType.OBJECT,
                properties: {
                  action: {
                    type: SchemaType.STRING,
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
                  } as Schema,
                  coordinate: {
                    type: SchemaType.ARRAY,
                    description: '(x, y): The x and y coordinates to move the mouse to. Required for `mouse_move`, `left_click`, `right_click`, `middle_click`, `double_click`, `left_click_drag` (to), and `cursor_position` (to).',
                    items: {
                      type: SchemaType.INTEGER,
                    },
                  } as Schema,
                  text: {
                    type: SchemaType.STRING,
                    description: 'The text to type. Required for `type` and `key`.',
                  } as Schema,
                },
                required: ['action'],
              },
            },
            {
              name: 'ask_user',
              description: 'Ask the user for clarity or additional information if you are stuck or need more details to complete the task.',
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  question: {
                    type: SchemaType.STRING,
                    description: 'The question to ask the user',
                  } as Schema,
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
            let responseContent = {};
            if (typeof block.content === 'string') {
               responseContent = { output: block.content };
            } else if (Array.isArray(block.content)) {
               const textPart = block.content.find(c => c.type === 'text');
               
               responseContent = { 
                 output: textPart?.type === 'text' ? textPart.text : '',
               };
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
    
    // Convert messages
    const contents = this.mapAnthropicToGemini(request.messages);
    
    // Convert system prompt
    let systemInstruction = undefined;
    if (request.systemPrompt) {
      systemInstruction = {
        role: 'user', // System instructions behave like a user prompt in some contexts, but API expects parts
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
          text: accumulatedText,
          citations: null
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
