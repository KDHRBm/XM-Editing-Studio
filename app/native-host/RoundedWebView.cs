using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using Microsoft.Web.WebView2.WinForms;

namespace XM.Native {
    // The native browser is a sibling of the HTML UI. CSS overflow cannot clip
    // it; set its HWND region so the page respects the same rounded boundary.
    internal sealed class RoundedWebView : WebView2 {
        private int radiusPixels = 18;
        internal int RadiusPixels {
            get { return radiusPixels; }
            set { int next = Math.Max(0,value); if (radiusPixels == next) return; radiusPixels=next; RefreshClip(); }
        }
        private void RefreshClip() {
            if (!IsHandleCreated || ClientSize.Width <= 0 || ClientSize.Height <= 0) return;
            Region next = null;
            if (radiusPixels > 0) {
                float width=ClientSize.Width,height=ClientSize.Height,diameter=Math.Min(radiusPixels*2,Math.Min(width,height));
                using (var path=new GraphicsPath()) {
                    path.AddArc(0,0,diameter,diameter,180,90);
                    path.AddArc(width-diameter,0,diameter,diameter,270,90);
                    path.AddArc(width-diameter,height-diameter,diameter,diameter,0,90);
                    path.AddArc(0,height-diameter,diameter,diameter,90,90);
                    path.CloseFigure();next=new Region(path);
                }
            }
            var old=Region; Region=next; if(old!=null)old.Dispose();
        }
        protected override void OnHandleCreated(EventArgs e) {base.OnHandleCreated(e);RefreshClip();}
        protected override void OnSizeChanged(EventArgs e) {base.OnSizeChanged(e);RefreshClip();}
    }
}
