import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHideOverlay = vi.fn().mockResolvedValue(undefined);
const mockShowOverlay = vi.fn();
const mockScreenshot = vi.fn();
const mockNativeImage = {
  createFromBuffer: vi.fn(),
};

vi.mock('./cursorIndicator', () => ({
  hideOverlay: mockHideOverlay,
  showOverlay: mockShowOverlay,
}));

vi.mock('screenshot-desktop', () => ({
  default: mockScreenshot,
}));

vi.mock('electron', () => ({
  nativeImage: mockNativeImage,
}));

describe('screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    const mockImage = {
      getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      resize: vi.fn().mockReturnThis(),
      toPNG: vi.fn().mockReturnValue(Buffer.from('png-data')),
      toJPEG: vi.fn().mockReturnValue(Buffer.from('jpeg-data')),
      crop: vi.fn().mockReturnThis(),
    };
    
    mockNativeImage.createFromBuffer.mockReturnValue(mockImage);
    mockScreenshot.mockResolvedValue(Buffer.from('screenshot-data'));
  });

  describe('capturePngBuffer', () => {
    it('should hide overlay before capture and show after', async () => {
      const { capturePngBuffer } = await import('./screen');
      
      await capturePngBuffer();
      
      expect(mockHideOverlay).toHaveBeenCalled();
      expect(mockShowOverlay).toHaveBeenCalled();
      expect(mockHideOverlay.mock.invocationCallOrder[0])
        .toBeLessThan(mockShowOverlay.mock.invocationCallOrder[0]);
    });

    it('should capture screenshot without resize when no options provided', async () => {
      const { capturePngBuffer } = await import('./screen');
      
      const result = await capturePngBuffer();
      
      expect(mockScreenshot).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should resize when width is specified', async () => {
      const mockImage = {
        getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
        resize: vi.fn().mockReturnThis(),
        toPNG: vi.fn().mockReturnValue(Buffer.from('png-data')),
      };
      mockNativeImage.createFromBuffer.mockReturnValue(mockImage);
      
      const { capturePngBuffer } = await import('./screen');
      
      await capturePngBuffer({ width: 960 });
      
      expect(mockImage.resize).toHaveBeenCalled();
    });

    it('should show overlay even if capture fails', async () => {
      mockScreenshot.mockRejectedValueOnce(new Error('Capture failed'));
      
      const { capturePngBuffer } = await import('./screen');
      
      await expect(capturePngBuffer()).rejects.toThrow('Capture failed');
      expect(mockShowOverlay).toHaveBeenCalled();
    });
  });

  describe('captureBase64', () => {
    it('should return base64 encoded JPEG', async () => {
      const { captureBase64 } = await import('./screen');
      
      const result = await captureBase64();
      
      expect(typeof result).toBe('string');
    });

    it('should use specified quality from options', async () => {
      const mockImage = {
        getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
        resize: vi.fn().mockReturnThis(),
        toJPEG: vi.fn().mockReturnValue(Buffer.from('jpeg-data')),
      };
      mockNativeImage.createFromBuffer.mockReturnValue(mockImage);
      
      const { captureBase64 } = await import('./screen');
      
      await captureBase64({ width: 960, height: 720, quality: 65 });
      
      expect(mockImage.toJPEG).toHaveBeenCalledWith(65);
    });

    it('should clamp quality between 40 and 95', async () => {
      const mockImage = {
        getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
        resize: vi.fn().mockReturnThis(),
        toJPEG: vi.fn().mockReturnValue(Buffer.from('jpeg-data')),
      };
      mockNativeImage.createFromBuffer.mockReturnValue(mockImage);
      
      const { captureBase64 } = await import('./screen');
      
      await captureBase64({ quality: 10 });
      expect(mockImage.toJPEG).toHaveBeenCalledWith(40);
      
      mockImage.toJPEG.mockClear();
      
      await captureBase64({ quality: 100 });
      expect(mockImage.toJPEG).toHaveBeenCalledWith(95);
    });
  });

  describe('captureRegionBase64', () => {
    it('should crop to specified region', async () => {
      const mockImage = {
        getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
        crop: vi.fn().mockReturnThis(),
        toJPEG: vi.fn().mockReturnValue(Buffer.from('jpeg-data')),
      };
      mockNativeImage.createFromBuffer.mockReturnValue(mockImage);
      
      const { captureRegionBase64 } = await import('./screen');
      
      await captureRegionBase64([100, 100, 500, 400]);
      
      expect(mockImage.crop).toHaveBeenCalledWith({
        x: 100,
        y: 100,
        width: 400,
        height: 300,
      });
    });

    it('should handle negative coordinates by clamping to 0', async () => {
      const mockImage = {
        getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
        crop: vi.fn().mockReturnThis(),
        toJPEG: vi.fn().mockReturnValue(Buffer.from('jpeg-data')),
      };
      mockNativeImage.createFromBuffer.mockReturnValue(mockImage);
      
      const { captureRegionBase64 } = await import('./screen');
      
      await captureRegionBase64([-10, -10, 100, 100]);
      
      expect(mockImage.crop).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 0,
          y: 0,
        })
      );
    });

    it('should ensure minimum width and height of 1', async () => {
      const mockImage = {
        getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
        crop: vi.fn().mockReturnThis(),
        toJPEG: vi.fn().mockReturnValue(Buffer.from('jpeg-data')),
      };
      mockNativeImage.createFromBuffer.mockReturnValue(mockImage);
      
      const { captureRegionBase64 } = await import('./screen');
      
      await captureRegionBase64([100, 100, 100, 100]);
      
      expect(mockImage.crop).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1,
          height: 1,
        })
      );
    });
  });
});
