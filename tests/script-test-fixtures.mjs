import { createServer } from 'node:http';
export const score = { title: '雨停之后', summary: '以克制的钢琴铺陈等待，用温暖弦乐完成从孤独到释然的过渡。', style: 'cinematic ambient, warm felt piano, gentle strings, 78 bpm, restrained dynamics, dialogue-friendly, no vocals', structure: [{ tag: 'Intro', content: 'Sparse felt piano over soft rain textures' }, { tag: 'Build', content: 'Warm strings gradually lift the mood, leave space for dialogue' }, { tag: 'Outro', content: 'Resolve to a gentle piano motif and fade out' }] };
export const script = '场景：雨夜，空荡的车站。\n林夏：你怎么还没走？我等了3.5小时！\n[EN] LIN: Why are you still here? I waited 3.5 hours!\n陈默：我在等一个人。\n[EN] CHEN: I am waiting for someone.\n旁白：远处的灯亮了，雨渐渐停了。\n[EN] NARRATOR: The lights came on. The rain slowly stopped.';
export const analysis = { summary: '雨夜重逢，从孤独和思念逐渐走向温暖释然，适合克制的钢琴和弦乐。', keywords: ['雨夜', '重逢', '思念', '温暖', '释然', '钢琴', 'rain', 'reunion', 'warm', 'piano'] };
export function wav() { const b = Buffer.alloc(16044); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(16000, 40); return b; }
export async function startMock(port = 0) {
  const calls = []; let count = 0;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/audio.wav') { res.setHeader('content-type', 'audio/wav'); return res.end(wav()); }
      const chunks = []; for await (const part of req) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      calls.push({ url: req.url, body, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      let answer;
      if (req.url.includes(':generateContent') || req.url.endsWith('/chat/completions')) {
        const userText = body.contents?.find(m => m.role === 'user')?.parts?.[0]?.text || body.messages?.find(m => m.role === 'user')?.content || '{}';
        let data; try { data = JSON.parse(userText); } catch { data = {}; }
        let content = score;
        if (data.musicTitles) content = { matches: data.musicTitles.filter(track => /温暖|钢琴|piano|rain/i.test(track.title)).slice(0, 3).map(track => ({ id: track.id, reason: '标题中的钢琴与温暖情绪适合剧本从思念到释然的转折。', keywords: ['钢琴', '温暖', '重逢'] })) };
        else if (data.originalScript && !data.editedLines) content = analysis;
        answer = req.url.includes(':generateContent') ? { candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }] } : { choices: [{ message: { content: JSON.stringify(content) } }] };
      }
      else if (req.url === '/suno/submit/music') answer = { data: { task_id: `mock-task-${++count}`, status: 'PENDING' } };
      else if (req.url === '/suno/fetch') answer = { data: (body.ids || []).map(id => ({ task_id: id, status: 'SUCCESS', clips: [{ id: `clip-${id}`, title: score.title, audio_url: `http://127.0.0.1:${server.address().port}/audio.wav`, duration: 1 }] })) };
      else { res.statusCode = 404; answer = { error: 'Unknown mock route' }; }
      res.end(JSON.stringify(answer));
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
