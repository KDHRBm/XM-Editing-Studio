using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace XM.Native {
    // HTML transparency does not clip an HWND. Clip the actual window as well,
    // so its opaque backing cannot appear outside the card's rounded corners.
    internal class RoundedWindow : Form {
        private int cornerRadius;
        internal int CornerRadius {
            get { return cornerRadius; }
            set { cornerRadius = value; RefreshShape(); }
        }
        private void RefreshShape() {
            if (!IsHandleCreated || ClientSize.Width <= 0 || ClientSize.Height <= 0) return;
            Region next = null;
            if (cornerRadius > 0 && WindowState != FormWindowState.Maximized) {
                float scale; using (var graphics = CreateGraphics()) scale = graphics.DpiX / 96f;
                float width = ClientSize.Width, height = ClientSize.Height;
                float diameter = Math.Min(cornerRadius * 2 * scale, Math.Min(width, height));
                using (var path = new GraphicsPath()) {
                    path.AddArc(0, 0, diameter, diameter, 180, 90);
                    path.AddArc(width - diameter, 0, diameter, diameter, 270, 90);
                    path.AddArc(width - diameter, height - diameter, diameter, diameter, 0, 90);
                    path.AddArc(0, height - diameter, diameter, diameter, 90, 90);
                    path.CloseFigure(); next = new Region(path);
                }
            }
            var previous = Region; Region = next; if (previous != null) previous.Dispose();
        }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); RefreshShape(); }
        protected override void OnSizeChanged(EventArgs e) { base.OnSizeChanged(e); RefreshShape(); }
        protected override void WndProc(ref Message m) { base.WndProc(ref m); if (m.Msg == 0x02E0) RefreshShape(); }
    }
}
