import { spawn } from 'child_process';

/**
 * FFmpeg로 webm → mp4 트랜스코딩 + 1초 지점 썸네일 생성.
 * child_process.spawn으로 메인 이벤트 루프 블로킹 방지.
 */
export function runFFmpeg(inputPath: string, outputPath: string, thumbnailPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      // 비디오 트랜스코딩
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-movflags', '+faststart',
      outputPath,
      // 썸네일 (1초 지점)
      '-ss', '00:00:01',
      '-vframes', '1',
      thumbnailPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: 'pipe' });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });

    proc.on('error', reject);
  });
}
