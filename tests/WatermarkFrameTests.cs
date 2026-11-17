using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace XMWatermark
{
    internal static class FrameLayoutTests
    {
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
        }

        private static void CheckFrame(int pitch, bool truncated, WatermarkOverlay overlay)
        {
            var layout = new VideoFrameLayout { Width = 6, Height = 4, Stride = pitch, Visible = new RectangleF(1, 1, 4, 2) };
            byte[] bytes = new byte[128];
            for (int i = 0; i < bytes.Length; i++) bytes[i] = 221;
            for (int y = 0; y < 4; y++)
                for (int x = 0; x < 6; x++)
                {
                    int offset = (pitch < 0 ? 3 - y : y) * 32 + x * 4;
                    bytes[offset] = (byte)(10 + x * 20);
                    bytes[offset + 1] = (byte)(20 + y * 30);
                    bytes[offset + 2] = (byte)(x + y);
                }
            IMFSample sample = null;
            IMFMediaBuffer source = null, output = null;
            try
            {
                MFInterop.MFCreateSample(out sample);
                MFInterop.MFCreateMemoryBuffer(128, out source);
                IntPtr pointer;
                uint max, length;
                source.Lock(out pointer, out max, out length);
                try { Marshal.Copy(bytes, 0, pointer, bytes.Length); }
                finally { source.Unlock(); }
                source.SetCurrentLength(truncated ? 32u : 128u);
                sample.AddBuffer(source);
                sample.SetSampleTime(123456);
                sample.SetSampleDuration(333333);
                if (truncated)
                {
                    bool rejected = false;
                    try { layout.NormalizeAndOverlay(sample, overlay); }
                    catch (InvalidDataException) { rejected = true; }
                    Check(rejected, "Truncated frame must be rejected");
                    return;
                }
                layout.NormalizeAndOverlay(sample, overlay);
                long time, duration;
                sample.GetSampleTime(out time);
                sample.GetSampleDuration(out duration);
                Check(time == 123456 && duration == 333333, "Sample timing changed");
                sample.ConvertToContiguousBuffer(out output);
                output.Lock(out pointer, out max, out length);
                try
                {
                    Check(length == 32, "Output is not tightly packed");
                    for (int y = 0; y < 2; y++)
                        for (int x = 0; x < 4; x++)
                        {
                            int offset = (y * 4 + x) * 4;
                            Check(Marshal.ReadByte(pointer, offset) == 10 + (x + 1) * 20, "Wrong column or padding copied");
                            Check(Marshal.ReadByte(pointer, offset + 1) == 20 + (y + 1) * 30, "Wrong row or orientation");
                            Check(Marshal.ReadByte(pointer, offset + 2) == x + y + 2, "Wrong visible aperture");
                        }
                }
                finally { output.Unlock(); }
            }
            finally
            {
                if (output != null) Marshal.ReleaseComObject(output);
                if (source != null) Marshal.ReleaseComObject(source);
                if (sample != null) Marshal.ReleaseComObject(sample);
            }
        }

        public static int Main(string[] args)
        {
            MFInterop.MFStartup(MFInterop.MF_VERSION, MFInterop.MFSTARTUP_NOSOCKET);
            try
            {
                string image = Path.Combine(args[0], "transparent.png");
                using (var bitmap = new Bitmap(4, 2, PixelFormat.Format32bppArgb))
                    bitmap.Save(image, ImageFormat.Png);
                var overlay = new WatermarkOverlay(4, 2, image, "", "fullscreen", 1, 1);
                CheckFrame(32, false, overlay);
                CheckFrame(-32, false, overlay);
                CheckFrame(32, true, overlay);
                Console.WriteLine("padded pitch, bottom-up orientation, aperture crop, timing and truncated buffers passed");
                return 0;
            }
            finally { MFInterop.MFShutdown(); }
        }
    }
}
