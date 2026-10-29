using System;
using System.Text;
using XM.Native;

internal static class NativeEngineTransportTests {
    public static int Main(string[] args) {
        if (args.Length > 0 && args[0] == "--echo") {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            string line;
            while ((line = Console.ReadLine()) != null) {
                var request = J.Decode(line);
                Console.WriteLine(J.Encode(J.Obj("id", J.Get(request, "id"), "state", J.Get(request, "args"))));
            }
            return 0;
        }
        // Reproduce a Simplified Chinese Windows host with UTF-8 child workers.
        Console.InputEncoding = Encoding.GetEncoding(936);
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            using (var engine = new Engine(System.Reflection.Assembly.GetExecutingAssembly().Location, "--echo")) {
                var samples = new[] {
                    "本地草稿 / 错睡",
                    "```json\r\n{\"heading\":{\"text\":\"本地草稿 / 错睡\",\"box\":[333,50,345,70]},\"region\":[345,50,444,391]}\r\n```",
                    "¡Sí! Señor Núñez — ¿Cómo estás? 🐟\nC:\\剪映草稿\\睡错40"
                };
                foreach (string text in samples) {
                    var result = engine.Call("echo", J.Obj("text", text)).GetAwaiter().GetResult();
                    if (J.Str(result, "text") != text) throw new Exception("Unicode engine payload was changed in transit");
                }
            }
            Console.WriteLine("UTF-8 worker transport passed: Chinese, fenced Gemini JSON, Spanish, emoji and paths");
            return 0;
        } catch (Exception error) { Console.WriteLine(error); return 1; }
    }
}
