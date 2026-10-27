import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadQueue, reserveDownloadPath, safeDownloadName, type DownloadRequest } from './downloads';

const dirs: string[] = [];
async function directory(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'tvm-download-')); dirs.push(path); return path; }
afterEach(async () => { await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const request = (directory: string): DownloadRequest => ({ directory, items: [{ id: 'tt1', title: 'Movie' }], preferences: { language: 'en', maxHeight: 1080 }, headers: { Authorization: 'Bearer private' } });

describe('download queue', () => {
  it('streams original bytes to the chosen directory without leaking account headers', async () => {
    const dir = await directory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://media.example/file.mkv', filename: 'file.mkv' })))
      .mockResolvedValueOnce(new Response('video-bytes', { headers: { 'content-length': '11' } }));
    const queue = createDownloadQueue('http://127.0.0.1:7345', fetchImpl, () => {});
    queue.enqueue(request(dir));
    await vi.waitFor(() => expect(queue.list()[0]?.state).toBe('complete'));
    const job = queue.list()[0]!;
    expect(await readFile(job.path!, 'utf8')).toBe('video-bytes');
    expect(job.bytes).toBe(11);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer private' });
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toBeUndefined();
    expect((await readdir(dir)).some((file) => file.endsWith('.part'))).toBe(false);
  });

  it('reserves a new name and preserves existing files', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'movie.mkv'), 'existing');
    const next = await reserveDownloadPath(dir, 'movie.mkv');
    expect(next).toBe(join(dir, 'movie (2).mkv'));
    expect(await readFile(join(dir, 'movie.mkv'), 'utf8')).toBe('existing');
    expect(safeDownloadName('../CON:bad\\name')).not.toMatch(/[<>:"/\\|?*]/);
    expect(safeDownloadName('CON')).toBe('TVM-CON');
  });

  it('removes partial output after a truncated file and continues the batch', async () => {
    const dir = await directory();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://media.example/one.mkv' })))
      .mockResolvedValueOnce(new Response('short', { headers: { 'content-length': '100' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://media.example/two.mkv' })))
      .mockResolvedValueOnce(new Response('complete'));
    const queue = createDownloadQueue('http://127.0.0.1:7345', fetchImpl, () => {});
    queue.enqueue({ ...request(dir), items: [{ id: 'tt1:1:1', title: 'Episode 1' }, { id: 'tt1:1:2', title: 'Episode 2' }] });
    await vi.waitFor(() => expect(queue.list()[1]?.state).toBe('complete'));
    expect(queue.list()[0]?.state).toBe('failed');
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('cancels a transfer, removes partial files, and skips cancelled queued episodes', async () => {
    const dir = await directory();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://media.example/one.mkv' })))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); } })));
    const queue = createDownloadQueue('http://127.0.0.1:7345', fetchImpl, () => {});
    queue.enqueue({ ...request(dir), items: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }] });
    await vi.waitFor(() => expect(queue.list()[0]?.bytes).toBe(2));
    queue.cancel(queue.list()[1]!.id); queue.cancel(queue.list()[0]!.id);
    await vi.waitFor(async () => expect(await readdir(dir)).toHaveLength(0));
    expect(queue.list().map((job) => job.state)).toEqual(['cancelled', 'cancelled']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
