using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace XMWatermark
{
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("2cd2d921-c447-44a7-a13c-4adabfc247e3")]
    internal interface IMFAttributes
    {
        void GetItem([In] ref Guid guidKey, IntPtr pValue);
        void GetItemType([In] ref Guid guidKey, out int pType);
        void CompareItem([In] ref Guid guidKey, IntPtr Value, [MarshalAs(UnmanagedType.Bool)] out bool pbResult);
        void Compare(IMFAttributes pTheirs, int MatchType, [MarshalAs(UnmanagedType.Bool)] out bool pbResult);
        void GetUINT32([In] ref Guid guidKey, out uint punValue);
        void GetUINT64([In] ref Guid guidKey, out ulong punValue);
        void GetDouble([In] ref Guid guidKey, out double pfValue);
        void GetGUID([In] ref Guid guidKey, out Guid pguidValue);
        void GetStringLength([In] ref Guid guidKey, out uint pcchLength);
        void GetString([In] ref Guid guidKey, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszValue, uint cchBufSize, out uint pcchLength);
        void GetAllocatedString([In] ref Guid guidKey, [MarshalAs(UnmanagedType.LPWStr)] out string ppwszValue, out uint pcchLength);
        void GetBlobSize([In] ref Guid guidKey, out uint pcbBlobSize);
        void GetBlob([In] ref Guid guidKey, [Out, MarshalAs(UnmanagedType.LPArray)] byte[] pBuf, uint cbBufSize, out uint pcbBlobSize);
        void GetAllocatedBlob([In] ref Guid guidKey, out IntPtr ppBuf, out uint pcbSize);
        void GetUnknown([In] ref Guid guidKey, [In] ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
        void SetItem([In] ref Guid guidKey, IntPtr Value);
        void DeleteItem([In] ref Guid guidKey);
        void DeleteAllItems();
        void SetUINT32([In] ref Guid guidKey, uint unValue);
        void SetUINT64([In] ref Guid guidKey, ulong unValue);
        void SetDouble([In] ref Guid guidKey, double fValue);
        void SetGUID([In] ref Guid guidKey, [In] ref Guid guidValue);
        void SetString([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.LPWStr)] string wszValue);
        void SetBlob([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] byte[] pBuf, uint cbBufSize);
        void SetUnknown([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.IUnknown)] object pUnknown);
        void LockStore();
        void UnlockStore();
        void GetCount(out uint pcItems);
        void GetItemByIndex(uint unIndex, out Guid pguidKey, IntPtr pValue);
        void CopyAllItems(IMFAttributes pDest);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("44ae0fa8-ea31-4109-8d2e-4cae4997c555")]
    internal interface IMFMediaType : IMFAttributes
    {
        new void GetItem([In] ref Guid guidKey, IntPtr pValue);
        new void GetItemType([In] ref Guid guidKey, out int pType);
        new void CompareItem([In] ref Guid guidKey, IntPtr Value, [MarshalAs(UnmanagedType.Bool)] out bool pbResult);
        new void Compare(IMFAttributes pTheirs, int MatchType, [MarshalAs(UnmanagedType.Bool)] out bool pbResult);
        new void GetUINT32([In] ref Guid guidKey, out uint punValue);
        new void GetUINT64([In] ref Guid guidKey, out ulong punValue);
        new void GetDouble([In] ref Guid guidKey, out double pfValue);
        new void GetGUID([In] ref Guid guidKey, out Guid pguidValue);
        new void GetStringLength([In] ref Guid guidKey, out uint pcchLength);
        new void GetString([In] ref Guid guidKey, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszValue, uint cchBufSize, out uint pcchLength);
        new void GetAllocatedString([In] ref Guid guidKey, [MarshalAs(UnmanagedType.LPWStr)] out string ppwszValue, out uint pcchLength);
        new void GetBlobSize([In] ref Guid guidKey, out uint pcbBlobSize);
        new void GetBlob([In] ref Guid guidKey, [Out, MarshalAs(UnmanagedType.LPArray)] byte[] pBuf, uint cbBufSize, out uint pcbBlobSize);
        new void GetAllocatedBlob([In] ref Guid guidKey, out IntPtr ppBuf, out uint pcbSize);
        new void GetUnknown([In] ref Guid guidKey, [In] ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
        new void SetItem([In] ref Guid guidKey, IntPtr Value);
        new void DeleteItem([In] ref Guid guidKey);
        new void DeleteAllItems();
        new void SetUINT32([In] ref Guid guidKey, uint unValue);
        new void SetUINT64([In] ref Guid guidKey, ulong unValue);
        new void SetDouble([In] ref Guid guidKey, double fValue);
        new void SetGUID([In] ref Guid guidKey, [In] ref Guid guidValue);
        new void SetString([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.LPWStr)] string wszValue);
        new void SetBlob([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] byte[] pBuf, uint cbBufSize);
        new void SetUnknown([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.IUnknown)] object pUnknown);
        new void LockStore();
        new void UnlockStore();
        new void GetCount(out uint pcItems);
        new void GetItemByIndex(uint unIndex, out Guid pguidKey, IntPtr pValue);
        new void CopyAllItems(IMFAttributes pDest);
        void GetMajorType(out Guid pguidMajorType);
        void IsCompressedFormat([MarshalAs(UnmanagedType.Bool)] out bool pfCompressed);
        void IsEqual(IMFMediaType pIMediaType, out uint pdwFlags);
        void GetRepresentation(Guid guidRepresentation, out IntPtr ppvRepresentation);
        void FreeRepresentation(Guid guidRepresentation, IntPtr pvRepresentation);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("045fa593-8799-42b8-bc8d-8968c6453507")]
    internal interface IMFMediaBuffer
    {
        void Lock(out IntPtr ppbBuffer, out uint pcbMaxLength, out uint pcbCurrentLength);
        void Unlock();
        void GetCurrentLength(out uint pcbCurrentLength);
        void SetCurrentLength(uint cbCurrentLength);
        void GetMaxLength(out uint pcbMaxLength);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("7dc9d5f9-9ed9-44ec-9bbf-0600bb589fbb")]
    internal interface IMF2DBuffer
    {
        void Lock2D(out IntPtr scanline0, out int pitch);
        void Unlock2D();
        void GetScanline0AndPitch(out IntPtr scanline0, out int pitch);
        void IsContiguousFormat([MarshalAs(UnmanagedType.Bool)] out bool contiguous);
        void GetContiguousLength(out uint length);
        void ContiguousCopyTo(IntPtr destination, uint length);
        void ContiguousCopyFrom(IntPtr source, uint length);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("c40a00f2-b93a-4d80-ae8c-5a1c634f58e4")]
    internal interface IMFSample : IMFAttributes
    {
        new void GetItem([In] ref Guid guidKey, IntPtr pValue);
        new void GetItemType([In] ref Guid guidKey, out int pType);
        new void CompareItem([In] ref Guid guidKey, IntPtr Value, [MarshalAs(UnmanagedType.Bool)] out bool pbResult);
        new void Compare(IMFAttributes pTheirs, int MatchType, [MarshalAs(UnmanagedType.Bool)] out bool pbResult);
        new void GetUINT32([In] ref Guid guidKey, out uint punValue);
        new void GetUINT64([In] ref Guid guidKey, out ulong punValue);
        new void GetDouble([In] ref Guid guidKey, out double pfValue);
        new void GetGUID([In] ref Guid guidKey, out Guid pguidValue);
        new void GetStringLength([In] ref Guid guidKey, out uint pcchLength);
        new void GetString([In] ref Guid guidKey, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszValue, uint cchBufSize, out uint pcchLength);
        new void GetAllocatedString([In] ref Guid guidKey, [MarshalAs(UnmanagedType.LPWStr)] out string ppwszValue, out uint pcchLength);
        new void GetBlobSize([In] ref Guid guidKey, out uint pcbBlobSize);
        new void GetBlob([In] ref Guid guidKey, [Out, MarshalAs(UnmanagedType.LPArray)] byte[] pBuf, uint cbBufSize, out uint pcbBlobSize);
        new void GetAllocatedBlob([In] ref Guid guidKey, out IntPtr ppBuf, out uint pcbSize);
        new void GetUnknown([In] ref Guid guidKey, [In] ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
        new void SetItem([In] ref Guid guidKey, IntPtr Value);
        new void DeleteItem([In] ref Guid guidKey);
        new void DeleteAllItems();
        new void SetUINT32([In] ref Guid guidKey, uint unValue);
        new void SetUINT64([In] ref Guid guidKey, ulong unValue);
        new void SetDouble([In] ref Guid guidKey, double fValue);
        new void SetGUID([In] ref Guid guidKey, [In] ref Guid guidValue);
        new void SetString([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.LPWStr)] string wszValue);
        new void SetBlob([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] byte[] pBuf, uint cbBufSize);
        new void SetUnknown([In] ref Guid guidKey, [In, MarshalAs(UnmanagedType.IUnknown)] object pUnknown);
        new void LockStore();
        new void UnlockStore();
        new void GetCount(out uint pcItems);
        new void GetItemByIndex(uint unIndex, out Guid pguidKey, IntPtr pValue);
        new void CopyAllItems(IMFAttributes pDest);
        void GetSampleFlags(out uint pdwSampleFlags);
        void SetSampleFlags(uint dwSampleFlags);
        void GetSampleTime(out long phnsSampleTime);
        void SetSampleTime(long hnsSampleTime);
        void GetSampleDuration(out long phnsSampleDuration);
        void SetSampleDuration(long hnsSampleDuration);
        void GetBufferCount(out uint pdwBufferCount);
        void GetBufferByIndex(uint dwIndex, out IMFMediaBuffer ppBuffer);
        void ConvertToContiguousBuffer(out IMFMediaBuffer ppBuffer);
        void AddBuffer(IMFMediaBuffer pBuffer);
        void RemoveBufferByIndex(uint dwIndex);
        void RemoveAllBuffers();
        void GetTotalLength(out uint pcbTotalLength);
        void CopyToBuffer(IMFMediaBuffer pBuffer);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("70ae66f2-c809-4e4f-8915-bdcb406b7993")]
    internal interface IMFSourceReader
    {
        void GetStreamSelection(uint dwStreamIndex, [MarshalAs(UnmanagedType.Bool)] out bool pfSelected);
        void SetStreamSelection(uint dwStreamIndex, [MarshalAs(UnmanagedType.Bool)] bool fSelected);
        void GetNativeMediaType(uint dwStreamIndex, uint dwMediaTypeIndex, out IMFMediaType ppMediaType);
        void GetCurrentMediaType(uint dwStreamIndex, out IMFMediaType ppMediaType);
        void SetCurrentMediaType(uint dwStreamIndex, IntPtr pdwReserved, IMFMediaType pMediaType);
        void SetCurrentPosition([In] ref Guid guidTimeFormat, IntPtr varPosition);
        void ReadSample(uint dwStreamIndex, uint dwControlFlags, out uint pdwActualStreamIndex, out uint pdwStreamFlags, out long pllTimestamp, out IMFSample ppSample);
        void Flush(uint dwStreamIndex);
        void GetServiceForStream(uint dwStreamIndex, [In] ref Guid guidService, [In] ref Guid riid, out IntPtr ppvObject);
        void GetPresentationAttribute(uint dwStreamIndex, [In] ref Guid guidAttribute, IntPtr pvarAttribute);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("3137f1cd-fe5e-4805-a5d8-fb477448cb3d")]
    internal interface IMFSinkWriter
    {
        void AddStream(IMFMediaType pTargetMediaType, out uint pdwStreamIndex);
        void SetInputMediaType(uint dwStreamIndex, IMFMediaType pInputMediaType, IMFAttributes pEncodingParameters);
        void BeginWriting();
        void WriteSample(uint dwStreamIndex, IMFSample pSample);
        void SendStreamTick(uint dwStreamIndex, long llTimestamp);
        void PlaceMarker(uint dwStreamIndex, IntPtr pvContext);
        void NotifyEndOfSegment(uint dwStreamIndex);
        void Flush(uint dwStreamIndex);
        void Finalize_();
        void GetServiceForStream(uint dwStreamIndex, [In] ref Guid guidService, [In] ref Guid riid, out IntPtr ppvObject);
        void GetStatistics(uint dwStreamIndex, IntPtr pStats);
    }

    internal static class MFInterop
    {
        public const uint MF_VERSION = 0x00020070;
        public const uint MFSTARTUP_NOSOCKET = 0x1;
        public const uint MF_SOURCE_READER_FIRST_VIDEO_STREAM = 0xFFFFFFFC;
        public const uint MF_SOURCE_READER_FIRST_AUDIO_STREAM = 0xFFFFFFFD;
        public const uint MF_SOURCE_READER_ALL_STREAMS = 0xFFFFFFFE;
        public const uint MF_SOURCE_READER_MEDIASOURCE = 0xFFFFFFFF;
        public const uint MF_SOURCE_READERF_ENDOFSTREAM = 0x00000002;
        public const uint MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED = 0x00000020;

        public static Guid MF_MT_MAJOR_TYPE = new Guid("48eba18e-f8c9-4687-bf11-0a74c9f96a8f");
        public static Guid MF_MT_SUBTYPE = new Guid("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
        public static Guid MF_MT_FRAME_SIZE = new Guid("1652c33d-d6b2-4012-b834-72030849a37d");
        public static Guid MF_MT_FRAME_RATE = new Guid("c459a2e8-3d2c-4e44-b132-fee5156c7bb0");
        public static Guid MF_MT_PIXEL_ASPECT_RATIO = new Guid("c6376a1e-8d0a-4027-be45-6d9a0ad39bb6");
        public static Guid MF_MT_INTERLACE_MODE = new Guid("e2724bb8-e676-4806-b4b2-a8d6efb44ccd");
        public static Guid MF_MT_AVG_BITRATE = new Guid("20332624-fb0d-4d9e-bd0d-cbf6786c102e");
        public static Guid MF_MT_DEFAULT_STRIDE = new Guid("644b4e48-1e02-4516-b0eb-c01ca9d49ac6");
        public static Guid MF_MT_MINIMUM_DISPLAY_APERTURE = new Guid("d7388766-18fe-48c6-a177-ee894867c8c4");
        public static Guid MF_MT_GEOMETRIC_APERTURE = new Guid("66758743-7e5f-400d-980a-aa8596c85696");
        public static Guid MF_MT_AUDIO_NUM_CHANNELS = new Guid("37e48bf5-645e-4c5b-89de-ada9e29b696a");
        public static Guid MF_MT_AUDIO_SAMPLES_PER_SECOND = new Guid("5faeeae7-0290-4c31-9e8a-c534f68d9dba");
        public static Guid MF_MT_AUDIO_BITS_PER_SAMPLE = new Guid("f2deb57f-40fa-4764-aa33-ed4f2d1ff669");
        public static Guid MF_MT_AUDIO_AVG_BYTES_PER_SECOND = new Guid("1aab75c8-cfef-451c-ab95-ac034b8e1731");

        public static Guid MFMediaType_Video = new Guid("73646976-0000-0010-8000-00AA00389B71");
        public static Guid MFMediaType_Audio = new Guid("73647561-0000-0010-8000-00AA00389B71");
        public static Guid MFVideoFormat_RGB32 = new Guid(22, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);
        public static Guid MFVideoFormat_H264 = new Guid("34363248-0000-0010-8000-00AA00389B71");
        public static Guid MFAudioFormat_PCM = new Guid(1, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);
        public static Guid MFAudioFormat_AAC = new Guid(0x1610, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);

        public static Guid MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS = new Guid("a634a91c-822b-41b9-a494-4de4643612b0");
        public static Guid MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING = new Guid("fb394f3d-ccf1-42ee-bbb3-f9b845d5681d");
        public static Guid MF_PD_DURATION = new Guid("6c990d33-bb8e-477a-8598-0d5d96fcd88a");

        [DllImport("mfplat.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFStartup(uint Version, uint dwFlags);

        [DllImport("mfplat.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFShutdown();

        [DllImport("mfplat.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFCreateAttributes(out IMFAttributes ppMFAttributes, uint cInitialSize);

        [DllImport("mfplat.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFCreateMediaType(out IMFMediaType ppMFType);

        [DllImport("mfplat.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFCreateSample(out IMFSample ppIMFSample);

        [DllImport("mfplat.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFCreateMemoryBuffer(uint cbMaxLength, out IMFMediaBuffer ppBuffer);

        [DllImport("mfplat.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFCopyImage(IntPtr destination, int destinationStride, IntPtr source, int sourceStride, uint widthBytes, uint lines);

        [DllImport("mfreadwrite.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFCreateSourceReaderFromURL([MarshalAs(UnmanagedType.LPWStr)] string pwszURL, IMFAttributes pAttributes, out IMFSourceReader ppSourceReader);

        [DllImport("mfreadwrite.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void MFCreateSinkWriterFromURL([MarshalAs(UnmanagedType.LPWStr)] string pwszOutputURL, IntPtr pByteStream, IMFAttributes pAttributes, out IMFSinkWriter ppSinkWriter);

        public static ulong Pack2UInt32(uint high, uint low)
        {
            return ((ulong)high << 32) | low;
        }

        public static void Unpack2UInt32(ulong packed, out uint high, out uint low)
        {
            high = (uint)(packed >> 32);
            low = (uint)(packed & 0xFFFFFFFFUL);
        }
    }

    internal struct SparsePixel
    {
        public int OffsetTopDown;
        public int OffsetBottomUp;
        public byte PremulB;
        public byte PremulG;
        public byte PremulR;
        public byte InvAlpha;
    }

    internal sealed class WatermarkOverlay
    {
        public readonly int Width;
        public readonly int Height;
        public readonly SparsePixel[] Pixels;

        public WatermarkOverlay(int width, int height, string watermarkImagePath, string watermarkText, string position, double opacity, double scale)
        {
            Width = width;
            Height = height;
            opacity = Math.Max(0.05, Math.Min(1.0, opacity));
            scale = Math.Max(0.05, Math.Min(1.0, scale));

            using (Bitmap canvas = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(canvas))
                {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

                    ColorMatrix cm = new ColorMatrix { Matrix33 = (float)opacity };
                    using (ImageAttributes ia = new ImageAttributes())
                    {
                        ia.SetColorMatrix(cm, ColorMatrixFlag.Default, ColorAdjustType.Bitmap);

                        string resolvedImagePath = watermarkImagePath;
                        if (string.Equals(resolvedImagePath, "builtin", StringComparison.OrdinalIgnoreCase))
                        {
                            resolvedImagePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "watermark.png");
                        }

                        if (!string.IsNullOrEmpty(resolvedImagePath) && File.Exists(resolvedImagePath))
                        {
                            using (Image wmImg = Image.FromFile(resolvedImagePath))
                            {
                                DrawOverlayImage(g, wmImg, ia, width, height, position, scale);
                            }
                        }
                        else
                        {
                            using (Bitmap stamp = RenderDefaultTextStamp(string.IsNullOrWhiteSpace(watermarkText) ? "内部样片 · 严禁外传" : watermarkText, width, height))
                            {
                                DrawOverlayImage(g, stamp, ia, width, height, position, scale);
                            }
                        }
                    }
                }

                BitmapData bd = canvas.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                try
                {
                    int byteCount = width * height * 4;
                    byte[] raw = new byte[byteCount];
                    Marshal.Copy(bd.Scan0, raw, 0, byteCount);

                    var list = new List<SparsePixel>(width * height / 10);
                    int stride = width * 4;
                    for (int y = 0; y < height; y++)
                    {
                        int rowTopDown = y * stride;
                        int rowBottomUp = (height - 1 - y) * stride;
                        for (int x = 0; x < width; x++)
                        {
                            int idx = rowTopDown + x * 4;
                            byte a = raw[idx + 3];
                            if (a < 3) continue;
                            byte b = raw[idx];
                            byte gr = raw[idx + 1];
                            byte r = raw[idx + 2];
                            list.Add(new SparsePixel
                            {
                                OffsetTopDown = idx,
                                OffsetBottomUp = rowBottomUp + x * 4,
                                PremulB = (byte)((b * a + 127) / 255),
                                PremulG = (byte)((gr * a + 127) / 255),
                                PremulR = (byte)((r * a + 127) / 255),
                                InvAlpha = (byte)(255 - a)
                            });
                        }
                    }
                    Pixels = list.ToArray();
                }
                finally
                {
                    canvas.UnlockBits(bd);
                }
            }
        }

        private static Bitmap RenderDefaultTextStamp(string text, int videoWidth, int videoHeight)
        {
            int baseDim = Math.Min(videoWidth, videoHeight);
            int fontSize = Math.Max(18, baseDim / 22);
            using (Font font = new Font("Microsoft YaHei UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel))
            {
                SizeF measured;
                using (Bitmap tmp = new Bitmap(1, 1))
                using (Graphics tg = Graphics.FromImage(tmp))
                {
                    measured = tg.MeasureString(text, font);
                }
                int w = Math.Max(120, (int)Math.Ceiling(measured.Width) + 40);
                int h = Math.Max(48, (int)Math.Ceiling(measured.Height) + 20);
                Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                    using (SolidBrush shadow = new SolidBrush(Color.FromArgb(140, 0, 0, 0)))
                    using (SolidBrush fg = new SolidBrush(Color.FromArgb(245, 255, 255, 255)))
                    {
                        g.DrawString(text, font, shadow, 22f, 12f);
                        g.DrawString(text, font, fg, 20f, 10f);
                    }
                }
                return bmp;
            }
        }

        private static void DrawOverlayImage(Graphics g, Image wm, ImageAttributes ia, int width, int height, string position, double scale)
        {
            if (position == "fullscreen")
            {
                // Exact behavior of Kirota233/watermarker: [1:v][0:v]scale2ref=w=main_w:h=main_h[wm][video];[video][wm]overlay=0:0
                Rectangle fullRect = new Rectangle(0, 0, width, height);
                g.DrawImage(wm, fullRect, 0, 0, wm.Width, wm.Height, GraphicsUnit.Pixel, ia);
                return;
            }

            int targetW = Math.Max(48, (int)Math.Round(width * scale));
            int targetH = Math.Max(24, (int)Math.Round((double)wm.Height / wm.Width * targetW));
            int padX = Math.Max(16, (int)(width * 0.03));
            int padY = Math.Max(16, (int)(height * 0.03));

            if (position == "tile")
            {
                int stepX = Math.Max(targetW + 80, width / 2);
                int stepY = Math.Max(targetH + 80, height / 3);
                for (int y = -height / 2; y < height * 3 / 2; y += stepY)
                {
                    for (int x = -width / 2; x < width * 3 / 2; x += stepX)
                    {
                        GraphicsState state = g.Save();
                        g.TranslateTransform(x + targetW / 2f, y + targetH / 2f);
                        g.RotateTransform(-28f);
                        Rectangle dest = new Rectangle(-targetW / 2, -targetH / 2, targetW, targetH);
                        g.DrawImage(wm, dest, 0, 0, wm.Width, wm.Height, GraphicsUnit.Pixel, ia);
                        g.Restore(state);
                    }
                }
                return;
            }

            int dx = width - targetW - padX;
            int dy = height - targetH - padY;
            if (position == "top-left") { dx = padX; dy = padY; }
            else if (position == "top-right") { dx = width - targetW - padX; dy = padY; }
            else if (position == "bottom-left") { dx = padX; dy = height - targetH - padY; }
            else if (position == "center") { dx = (width - targetW) / 2; dy = (height - targetH) / 2; }

            Rectangle rect = new Rectangle(dx, dy, targetW, targetH);
            g.DrawImage(wm, rect, 0, 0, wm.Width, wm.Height, GraphicsUnit.Pixel, ia);
        }

        public void ApplyToBuffer(IntPtr bufferPtr, uint bufferLen, bool bottomUp)
        {
            int maxByteOffset = (int)bufferLen - 4;
            int len = Pixels.Length;
            if (bottomUp)
            {
                for (int i = 0; i < len; i++)
                {
                    SparsePixel p = Pixels[i];
                    if (p.OffsetBottomUp > maxByteOffset) continue;
                    IntPtr px = IntPtr.Add(bufferPtr, p.OffsetBottomUp);
                    byte b = Marshal.ReadByte(px, 0);
                    byte g = Marshal.ReadByte(px, 1);
                    byte r = Marshal.ReadByte(px, 2);
                    Marshal.WriteByte(px, 0, (byte)(p.PremulB + (b * p.InvAlpha + 127) / 255));
                    Marshal.WriteByte(px, 1, (byte)(p.PremulG + (g * p.InvAlpha + 127) / 255));
                    Marshal.WriteByte(px, 2, (byte)(p.PremulR + (r * p.InvAlpha + 127) / 255));
                }
            }
            else
            {
                for (int i = 0; i < len; i++)
                {
                    SparsePixel p = Pixels[i];
                    if (p.OffsetTopDown > maxByteOffset) continue;
                    IntPtr px = IntPtr.Add(bufferPtr, p.OffsetTopDown);
                    byte b = Marshal.ReadByte(px, 0);
                    byte g = Marshal.ReadByte(px, 1);
                    byte r = Marshal.ReadByte(px, 2);
                    Marshal.WriteByte(px, 0, (byte)(p.PremulB + (b * p.InvAlpha + 127) / 255));
                    Marshal.WriteByte(px, 1, (byte)(p.PremulG + (g * p.InvAlpha + 127) / 255));
                    Marshal.WriteByte(px, 2, (byte)(p.PremulR + (r * p.InvAlpha + 127) / 255));
                }
            }
        }
    }

    // The decoder can enlarge RGB frames to codec alignment on the FIRST sample.
    // Keep its storage size/pitch separate from the visible and encoded frame sizes.
    internal sealed class VideoFrameLayout
    {
        public int Width, Height, Stride;
        public RectangleF Visible;

        public static VideoFrameLayout Read(IMFSourceReader reader)
        {
            IMFMediaType type;
            reader.GetCurrentMediaType(MFInterop.MF_SOURCE_READER_FIRST_VIDEO_STREAM, out type);
            try
            {
                Guid subtype;
                type.GetGUID(ref MFInterop.MF_MT_SUBTYPE, out subtype);
                if (subtype != MFInterop.MFVideoFormat_RGB32) throw new InvalidDataException("视频解码格式发生变化，无法安全添加水印。");
                ulong size;
                type.GetUINT64(ref MFInterop.MF_MT_FRAME_SIZE, out size);
                var layout = new VideoFrameLayout { Width = checked((int)(size >> 32)), Height = checked((int)(size & 0xFFFFFFFFUL)) };
                if (layout.Width <= 0 || layout.Height <= 0) throw new InvalidDataException("视频帧尺寸无效。");
                layout.Stride = checked(layout.Width * 4);
                uint stride;
                try { type.GetUINT32(ref MFInterop.MF_MT_DEFAULT_STRIDE, out stride); layout.Stride = unchecked((int)stride); }
                catch (COMException) { }
                layout.ValidatePitch(layout.Stride);
                layout.Visible = new RectangleF(0, 0, layout.Width, layout.Height);
                // MFVideoArea: two MFOffset values (USHORT fraction, SHORT value), SIZE.
                foreach (Guid key in new[] { MFInterop.MF_MT_MINIMUM_DISPLAY_APERTURE, MFInterop.MF_MT_GEOMETRIC_APERTURE })
                {
                    Guid aperture = key;
                    byte[] area = new byte[16];
                    uint length;
                    try { type.GetBlob(ref aperture, area, 16, out length); }
                    catch (COMException) { continue; }
                    if (length != 16) throw new InvalidDataException("视频可见区域信息无效。");
                    float x = BitConverter.ToInt16(area, 2) + BitConverter.ToUInt16(area, 0) / 65536f;
                    float y = BitConverter.ToInt16(area, 6) + BitConverter.ToUInt16(area, 4) / 65536f;
                    int width = BitConverter.ToInt32(area, 8), height = BitConverter.ToInt32(area, 12);
                    if (width == 0 && height == 0) continue;
                    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > layout.Width || y + height > layout.Height)
                        throw new InvalidDataException("视频可见区域超出解码帧范围。");
                    layout.Visible = new RectangleF(x, y, width, height);
                    break;
                }
                return layout;
            }
            finally { Marshal.ReleaseComObject(type); }
        }

        private void ValidatePitch(int pitch)
        {
            if (Math.Abs((long)pitch) < (long)Width * 4 || Math.Abs((long)pitch) * Height > int.MaxValue)
                throw new InvalidDataException("视频帧行跨度无效。");
        }

        internal void CopyVisible(IntPtr top, int pitch, IntPtr destination, int width, int height)
        {
            ValidatePitch(pitch);
            int destinationStride = checked(width * 4);
            if (Visible.Width == width && Visible.Height == height && Visible.X == (int)Visible.X && Visible.Y == (int)Visible.Y)
            {
                IntPtr source = IntPtr.Add(top, checked((int)Visible.Y * pitch + (int)Visible.X * 4));
                MFInterop.MFCopyImage(destination, destinationStride, source, pitch, (uint)destinationStride, (uint)height);
            }
            else
            {
                using (var source = new Bitmap(Width, Height, pitch, PixelFormat.Format32bppRgb, top))
                using (var target = new Bitmap(width, height, destinationStride, PixelFormat.Format32bppRgb, destination))
                using (var graphics = Graphics.FromImage(target))
                {
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.DrawImage(source, new RectangleF(0, 0, width, height), Visible, GraphicsUnit.Pixel);
                }
            }
        }

        public void NormalizeAndOverlay(IMFSample sample, WatermarkOverlay overlay)
        {
            IMFMediaBuffer source = null, target = null;
            try
            {
                sample.ConvertToContiguousBuffer(out source);
                uint length = checked((uint)(overlay.Width * overlay.Height * 4));
                MFInterop.MFCreateMemoryBuffer(length, out target);
                IntPtr destination;
                uint maximum, current;
                target.Lock(out destination, out maximum, out current);
                try
                {
                    var surface = source as IMF2DBuffer;
                    IntPtr top;
                    int pitch;
                    if (surface != null)
                    {
                        surface.Lock2D(out top, out pitch);
                        try { CopyVisible(top, pitch, destination, overlay.Width, overlay.Height); }
                        finally { surface.Unlock2D(); }
                    }
                    else
                    {
                        source.Lock(out top, out maximum, out current);
                        try
                        {
                            long required = Math.Abs((long)Stride) * (Height - 1) + (long)Width * 4;
                            if (required > current || current > maximum) throw new InvalidDataException("视频帧数据不完整，已停止生成，避免输出花屏视频。");
                            if (Stride < 0) top = IntPtr.Add(top, checked((Height - 1) * -Stride));
                            CopyVisible(top, Stride, destination, overlay.Width, overlay.Height);
                        }
                        finally { source.Unlock(); }
                    }
                    overlay.ApplyToBuffer(destination, length, false);
                }
                finally { target.Unlock(); }
                target.SetCurrentLength(length);
                // Retain the original sample's timestamps, duration and attributes.
                sample.RemoveAllBuffers();
                sample.AddBuffer(target);
            }
            finally
            {
                if (target != null) Marshal.ReleaseComObject(target);
                if (source != null) Marshal.ReleaseComObject(source);
            }
        }
    }

    internal static class VideoTranscoder
    {
        public static void ComputeOutputSize(uint inW, uint inH, string sizePreset, out uint outW, out uint outH)
        {
            outW = inW;
            outH = inH;
            if (sizePreset == "480p" || sizePreset == "720p" || sizePreset == "1080p")
            {
                uint targetShort = sizePreset == "480p" ? 480u : sizePreset == "720p" ? 720u : 1080u;
                bool portrait = inH > inW;
                uint currentShort = portrait ? inW : inH;
                if (currentShort > targetShort)
                {
                    double ratio = (double)targetShort / currentShort;
                    outW = (uint)Math.Max(2, ((int)Math.Round(inW * ratio) / 2) * 2);
                    outH = (uint)Math.Max(2, ((int)Math.Round(inH * ratio) / 2) * 2);
                }
            }
            outW = (outW / 2) * 2;
            outH = (outH / 2) * 2;
        }

        private static long TryGetDuration(IMFSourceReader reader)
        {
            IntPtr propVar = Marshal.AllocHGlobal(32);
            try
            {
                for (int i = 0; i < 32; i++) Marshal.WriteByte(propVar, i, 0);
                reader.GetPresentationAttribute(MFInterop.MF_SOURCE_READER_MEDIASOURCE, ref MFInterop.MF_PD_DURATION, propVar);
                ushort vt = (ushort)Marshal.ReadInt16(propVar, 0);
                if (vt == 21) // VT_UI8
                {
                    return Marshal.ReadInt64(propVar, 8);
                }
                return 0;
            }
            catch
            {
                return 0;
            }
            finally
            {
                Marshal.FreeHGlobal(propVar);
            }
        }

        public static void ProcessVideo(
            string inputPath,
            string outputPath,
            string watermarkImagePath,
            string watermarkText,
            string position,
            double opacity,
            double scale,
            string sizePreset,
            int qualityCrf,
            Action<int> onProgress,
            Func<bool> isCancelled)
        {
            IMFAttributes readerAttr = null;
            IMFAttributes writerAttr = null;
            IMFSourceReader reader = null;
            IMFSinkWriter writer = null;

            string tempOutput = outputPath + ".part-" + Guid.NewGuid().ToString("N") + ".mp4";
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath)));

            try
            {
                MFInterop.MFCreateAttributes(out readerAttr, 2);
                readerAttr.SetUINT32(ref MFInterop.MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);
                readerAttr.SetUINT32(ref MFInterop.MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1);

                MFInterop.MFCreateSourceReaderFromURL(Path.GetFullPath(inputPath), readerAttr, out reader);
                reader.SetStreamSelection(MFInterop.MF_SOURCE_READER_ALL_STREAMS, false);
                reader.SetStreamSelection(MFInterop.MF_SOURCE_READER_FIRST_VIDEO_STREAM, true);

                IMFMediaType nativeVideoType;
                reader.GetNativeMediaType(MFInterop.MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, out nativeVideoType);
                ulong packedSize;
                nativeVideoType.GetUINT64(ref MFInterop.MF_MT_FRAME_SIZE, out packedSize);
                uint inW, inH;
                MFInterop.Unpack2UInt32(packedSize, out inW, out inH);

                ulong packedRate = MFInterop.Pack2UInt32(30, 1);
                try { nativeVideoType.GetUINT64(ref MFInterop.MF_MT_FRAME_RATE, out packedRate); } catch { }
                Marshal.ReleaseComObject(nativeVideoType);

                uint outW, outH;
                ComputeOutputSize(inW, inH, sizePreset, out outW, out outH);

                IMFMediaType decodeVideoType;
                MFInterop.MFCreateMediaType(out decodeVideoType);
                decodeVideoType.SetGUID(ref MFInterop.MF_MT_MAJOR_TYPE, ref MFInterop.MFMediaType_Video);
                decodeVideoType.SetGUID(ref MFInterop.MF_MT_SUBTYPE, ref MFInterop.MFVideoFormat_RGB32);
                decodeVideoType.SetUINT64(ref MFInterop.MF_MT_FRAME_SIZE, MFInterop.Pack2UInt32(outW, outH));
                try
                {
                    reader.SetCurrentMediaType(MFInterop.MF_SOURCE_READER_FIRST_VIDEO_STREAM, IntPtr.Zero, decodeVideoType);
                }
                catch
                {
                    // Basic source-reader processing may reject scaling. Decode at
                    // source size and normalize below without losing the chosen output size.
                    decodeVideoType.SetUINT64(ref MFInterop.MF_MT_FRAME_SIZE, MFInterop.Pack2UInt32(inW, inH));
                    reader.SetCurrentMediaType(MFInterop.MF_SOURCE_READER_FIRST_VIDEO_STREAM, IntPtr.Zero, decodeVideoType);
                }
                Marshal.ReleaseComObject(decodeVideoType);

                VideoFrameLayout frameLayout = VideoFrameLayout.Read(reader);

                MFInterop.MFCreateAttributes(out writerAttr, 2);
                writerAttr.SetUINT32(ref MFInterop.MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);
                MFInterop.MFCreateSinkWriterFromURL(Path.GetFullPath(tempOutput), IntPtr.Zero, writerAttr, out writer);

                // Configure H.264 Output Stream (bitrate scaling aligned with Kirota233/watermarker: 12Mbps / 5Mbps / 2Mbps @ 1080p)
                IMFMediaType videoOut;
                MFInterop.MFCreateMediaType(out videoOut);
                videoOut.SetGUID(ref MFInterop.MF_MT_MAJOR_TYPE, ref MFInterop.MFMediaType_Video);
                videoOut.SetGUID(ref MFInterop.MF_MT_SUBTYPE, ref MFInterop.MFVideoFormat_H264);
                double baseBitrate = qualityCrf <= 18 ? 12000000.0 : (qualityCrf >= 28 ? 2000000.0 : 5000000.0);
                double areaRatio = (double)(outW * outH) / (1920.0 * 1080.0);
                uint bitrate = (uint)Math.Max(500000, Math.Min(30000000, Math.Round(baseBitrate * areaRatio)));
                videoOut.SetUINT32(ref MFInterop.MF_MT_AVG_BITRATE, bitrate);
                videoOut.SetUINT32(ref MFInterop.MF_MT_INTERLACE_MODE, 2); // Progressive
                videoOut.SetUINT64(ref MFInterop.MF_MT_FRAME_SIZE, MFInterop.Pack2UInt32(outW, outH));
                videoOut.SetUINT64(ref MFInterop.MF_MT_FRAME_RATE, packedRate);
                videoOut.SetUINT64(ref MFInterop.MF_MT_PIXEL_ASPECT_RATIO, MFInterop.Pack2UInt32(1, 1));

                uint videoSinkStream;
                writer.AddStream(videoOut, out videoSinkStream);
                IMFMediaType packedVideoIn;
                MFInterop.MFCreateMediaType(out packedVideoIn);
                try
                {
                    packedVideoIn.SetGUID(ref MFInterop.MF_MT_MAJOR_TYPE, ref MFInterop.MFMediaType_Video);
                    packedVideoIn.SetGUID(ref MFInterop.MF_MT_SUBTYPE, ref MFInterop.MFVideoFormat_RGB32);
                    packedVideoIn.SetUINT64(ref MFInterop.MF_MT_FRAME_SIZE, MFInterop.Pack2UInt32(outW, outH));
                    packedVideoIn.SetUINT32(ref MFInterop.MF_MT_DEFAULT_STRIDE, checked(outW * 4));
                    packedVideoIn.SetUINT32(ref MFInterop.MF_MT_INTERLACE_MODE, 2);
                    packedVideoIn.SetUINT64(ref MFInterop.MF_MT_FRAME_RATE, packedRate);
                    packedVideoIn.SetUINT64(ref MFInterop.MF_MT_PIXEL_ASPECT_RATIO, MFInterop.Pack2UInt32(1, 1));
                    writer.SetInputMediaType(videoSinkStream, packedVideoIn, null);
                }
                finally { Marshal.ReleaseComObject(packedVideoIn); }
                Marshal.ReleaseComObject(videoOut);

                // Configure Optional Audio Stream
                bool hasAudio = false;
                uint audioSinkStream = 0;
                try
                {
                    reader.SetStreamSelection(MFInterop.MF_SOURCE_READER_FIRST_AUDIO_STREAM, true);
                    IMFMediaType nativeAudio;
                    reader.GetNativeMediaType(MFInterop.MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, out nativeAudio);
                    uint channels = 2, sampleRate = 44100;
                    try { nativeAudio.GetUINT32(ref MFInterop.MF_MT_AUDIO_NUM_CHANNELS, out channels); } catch { }
                    try { nativeAudio.GetUINT32(ref MFInterop.MF_MT_AUDIO_SAMPLES_PER_SECOND, out sampleRate); } catch { }
                    Marshal.ReleaseComObject(nativeAudio);
                    if (channels < 1 || channels > 2) channels = 2;
                    if (sampleRate != 44100 && sampleRate != 48000) sampleRate = 44100;

                    IMFMediaType pcmAudio;
                    MFInterop.MFCreateMediaType(out pcmAudio);
                    pcmAudio.SetGUID(ref MFInterop.MF_MT_MAJOR_TYPE, ref MFInterop.MFMediaType_Audio);
                    pcmAudio.SetGUID(ref MFInterop.MF_MT_SUBTYPE, ref MFInterop.MFAudioFormat_PCM);
                    pcmAudio.SetUINT32(ref MFInterop.MF_MT_AUDIO_NUM_CHANNELS, channels);
                    pcmAudio.SetUINT32(ref MFInterop.MF_MT_AUDIO_SAMPLES_PER_SECOND, sampleRate);
                    pcmAudio.SetUINT32(ref MFInterop.MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
                    reader.SetCurrentMediaType(MFInterop.MF_SOURCE_READER_FIRST_AUDIO_STREAM, IntPtr.Zero, pcmAudio);
                    Marshal.ReleaseComObject(pcmAudio);

                    IMFMediaType actualAudioIn;
                    reader.GetCurrentMediaType(MFInterop.MF_SOURCE_READER_FIRST_AUDIO_STREAM, out actualAudioIn);

                    IMFMediaType aacOut;
                    MFInterop.MFCreateMediaType(out aacOut);
                    aacOut.SetGUID(ref MFInterop.MF_MT_MAJOR_TYPE, ref MFInterop.MFMediaType_Audio);
                    aacOut.SetGUID(ref MFInterop.MF_MT_SUBTYPE, ref MFInterop.MFAudioFormat_AAC);
                    aacOut.SetUINT32(ref MFInterop.MF_MT_AUDIO_SAMPLES_PER_SECOND, sampleRate);
                    aacOut.SetUINT32(ref MFInterop.MF_MT_AUDIO_NUM_CHANNELS, channels);
                    aacOut.SetUINT32(ref MFInterop.MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
                    aacOut.SetUINT32(ref MFInterop.MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 16000);

                    writer.AddStream(aacOut, out audioSinkStream);
                    writer.SetInputMediaType(audioSinkStream, actualAudioIn, null);
                    Marshal.ReleaseComObject(aacOut);
                    Marshal.ReleaseComObject(actualAudioIn);
                    hasAudio = true;
                }
                catch
                {
                    try { reader.SetStreamSelection(MFInterop.MF_SOURCE_READER_FIRST_AUDIO_STREAM, false); } catch { }
                    hasAudio = false;
                }

                var overlay = new WatermarkOverlay((int)outW, (int)outH, watermarkImagePath, watermarkText, position, opacity, scale);
                long duration = TryGetDuration(reader);

                writer.BeginWriting();

                bool videoDone = false;
                bool audioDone = !hasAudio;
                long nextVideoPts = 0;
                long nextAudioPts = 0;
                int lastReportedPct = 0;

                while (!videoDone || !audioDone)
                {
                    if (isCancelled()) throw new OperationCanceledException("任务已取消");

                    bool readVideo = !videoDone && (audioDone || nextVideoPts <= nextAudioPts);
                    uint streamToRead = readVideo ? MFInterop.MF_SOURCE_READER_FIRST_VIDEO_STREAM : MFInterop.MF_SOURCE_READER_FIRST_AUDIO_STREAM;

                    uint actualStream, flags;
                    long timestamp;
                    IMFSample sample;
                    reader.ReadSample(streamToRead, 0, out actualStream, out flags, out timestamp, out sample);

                    if ((flags & MFInterop.MF_SOURCE_READERF_ENDOFSTREAM) != 0)
                    {
                        if (readVideo) videoDone = true;
                        else audioDone = true;
                        if (sample != null) Marshal.ReleaseComObject(sample);
                        continue;
                    }

                    try
                    {
                        // A format-change notification may arrive with or without a sample.
                        if (readVideo && (flags & MFInterop.MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED) != 0)
                            frameLayout = VideoFrameLayout.Read(reader);
                        if (sample == null) continue;
                        if (readVideo)
                        {
                            nextVideoPts = timestamp;
                            frameLayout.NormalizeAndOverlay(sample, overlay);
                            writer.WriteSample(videoSinkStream, sample);

                            if (duration > 0)
                            {
                                int pct = (int)Math.Min(99L, (timestamp * 100L) / duration);
                                if (pct > lastReportedPct)
                                {
                                    lastReportedPct = pct;
                                    onProgress(pct);
                                }
                            }
                        }
                        else
                        {
                            nextAudioPts = timestamp;
                            writer.WriteSample(audioSinkStream, sample);
                        }
                    }
                    finally
                    {
                        if (sample != null) Marshal.ReleaseComObject(sample);
                    }
                }

                writer.Finalize_();
                Marshal.ReleaseComObject(writer);
                writer = null;
                Marshal.ReleaseComObject(reader);
                reader = null;

                File.Move(tempOutput, outputPath);
                onProgress(100);
            }
            finally
            {
                if (writer != null) { try { Marshal.ReleaseComObject(writer); } catch { } }
                if (reader != null) { try { Marshal.ReleaseComObject(reader); } catch { } }
                if (writerAttr != null) { try { Marshal.ReleaseComObject(writerAttr); } catch { } }
                if (readerAttr != null) { try { Marshal.ReleaseComObject(readerAttr); } catch { } }
                if (File.Exists(tempOutput)) { try { File.Delete(tempOutput); } catch { } }
            }
        }
    }

    internal static class Program
    {
        private static readonly object WriteLock = new object();
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private static volatile bool Cancelled = false;

        private static void Send(object payload)
        {
            lock (WriteLock)
            {
                Console.Out.WriteLine(Json.Serialize(payload));
                Console.Out.Flush();
            }
        }

        public static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);

            if (args.Length == 1 && args[0] == "--verify-runtime")
            {
                Send(new Dictionary<string, object> { { "ok", true }, { "engine", "windows-media-foundation-hw" } });
                return 0;
            }

            MFInterop.MFStartup(MFInterop.MF_VERSION, MFInterop.MFSTARTUP_NOSOCKET);
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    var req = Json.Deserialize<Dictionary<string, object>>(line);
                    if (req == null) continue;
                    object reqId = req.ContainsKey("id") ? req["id"] : null;
                    string action = req.ContainsKey("action") ? Convert.ToString(req["action"]) : "";

                    if (action == "shutdown")
                    {
                        Cancelled = true;
                        Send(new Dictionary<string, object> { { "id", reqId }, { "ok", true } });
                        return 0;
                    }
                    if (action == "cancel")
                    {
                        Cancelled = true;
                        Send(new Dictionary<string, object> { { "id", reqId }, { "ok", true } });
                        continue;
                    }
                    if (action == "process")
                    {
                        Cancelled = false;
                        ThreadPool.QueueUserWorkItem(_ =>
                        {
                            try
                            {
                                string inputPath = Convert.ToString(req["input"]);
                                string outputPath = Convert.ToString(req["output"]);
                                string wmImage = req.ContainsKey("watermarkImage") ? Convert.ToString(req["watermarkImage"]) : "";
                                string wmText = req.ContainsKey("watermarkText") ? Convert.ToString(req["watermarkText"]) : "内部样片 · 严禁外传";
                                string position = req.ContainsKey("position") ? Convert.ToString(req["position"]) : "tile";
                                double opacity = req.ContainsKey("opacity") ? Convert.ToDouble(req["opacity"], CultureInfo.InvariantCulture) : 0.35;
                                double scale = req.ContainsKey("scale") ? Convert.ToDouble(req["scale"], CultureInfo.InvariantCulture) : 0.28;
                                string sizePreset = req.ContainsKey("size") ? Convert.ToString(req["size"]) : "original";
                                int crf = req.ContainsKey("crf") ? Convert.ToInt32(req["crf"], CultureInfo.InvariantCulture) : 23;

                                Stopwatch sw = Stopwatch.StartNew();
                                VideoTranscoder.ProcessVideo(
                                    inputPath,
                                    outputPath,
                                    wmImage,
                                    wmText,
                                    position,
                                    opacity,
                                    scale,
                                    sizePreset,
                                    crf,
                                    pct => Send(new Dictionary<string, object> { { "event", "progress" }, { "id", reqId }, { "progress", pct } }),
                                    () => Cancelled
                                );
                                Send(new Dictionary<string, object>
                                {
                                    { "id", reqId },
                                    { "ok", true },
                                    { "output", outputPath },
                                    { "elapsedMs", sw.ElapsedMilliseconds }
                                });
                            }
                            catch (Exception ex)
                            {
                                Send(new Dictionary<string, object>
                                {
                                    { "id", reqId },
                                    { "error", ex.Message ?? "处理视频失败" }
                                });
                            }
                        });
                    }
                }
            }
            finally
            {
                MFInterop.MFShutdown();
            }
            return 0;
        }
    }
}
