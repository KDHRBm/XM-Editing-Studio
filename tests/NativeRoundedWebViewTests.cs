using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using XM.Native;

internal static class NativeRoundedWebViewTests {
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr window,IntPtr region);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
    [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr region,int x,int y);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    static void Check(bool condition,string message){if(!condition)throw new Exception(message);}
    static void CheckCorners(RoundedWebView view) {
        IntPtr region=CreateRectRgn(0,0,0,0);
        try {
            Check(GetWindowRgn(view.Handle,region)==3,"Browser HWND must have a rounded region");
            int w=view.ClientSize.Width,h=view.ClientSize.Height;
            foreach(var point in new[]{new Point(0,0),new Point(w-1,0),new Point(0,h-1),new Point(w-1,h-1)})
                Check(!PtInRegion(region,point.X,point.Y),"All four native corners must be clipped");
            foreach(var point in new[]{new Point(w/2,h/2),new Point(w/2,1),new Point(1,h/2),new Point(w-2,h/2),new Point(w/2,h-2)})
                Check(PtInRegion(region,point.X,point.Y),"Browser content and edge centers remain visible");
        } finally {DeleteObject(region);}
    }
    [STAThread] static int Main() {
        using(var form=new Form()) using(var view=new RoundedWebView()) {
            form.Controls.Add(view);view.Size=new Size(600,400);var handle=view.Handle;
            CheckCorners(view);
            view.Size=new Size(1250,800);CheckCorners(view);
            view.RadiusPixels=27;CheckCorners(view);
            Check(!view.Region.IsVisible(3,3)&&view.Region.IsVisible(27,3),"Scaled radius leaves interior visible");
            view.Visible=false;view.Visible=true;CheckCorners(view);
            view.Size=new Size(16,12);CheckCorners(view);
            view.RadiusPixels=0;Check(view.Region==null,"Zero radius removes clipping");
            view.Size=new Size(800,600);view.RadiusPixels=18;CheckCorners(view);
            Check(view.Handle==handle,"Resize and visibility changes keep the same browser handle");
        }
        Console.WriteLine("Native WebView four-corner clipping, resizing and reuse passed");return 0;
    }
}
