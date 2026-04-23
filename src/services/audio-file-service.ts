import * as fs from "fs";
import * as path from "path";

const RECORDINGS_BASE = "/recordings";

/**
 * 获取指定 roomId 和 memberId 的最新录制文件
 * 按文件修改时间排序，返回最新的文件路径
 */
export function getLatestRecording(roomId: string, memberId: string): { filePath: string; mimeType: string } | null {
  const dir = path.join(RECORDINGS_BASE, `room/${roomId}/${memberId}`);

  if (!fs.existsSync(dir)) {
    console.log(`[audio-file-service] 目录不存在: ${dir}`);
    return null;
  }

  const files = fs.readdirSync(dir)
    .map(name => {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      return { name, filePath, mtime: stat.mtime, size: stat.size };
    })
    .filter(f => f.size > 0)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (files.length === 0) {
    console.log(`[audio-file-service] 未找到录制文件: roomId=${roomId}, memberId=${memberId}`);
    return null;
  }

  const latest = files[0];
  console.log(`[audio-file-service] 找到录制文件: roomId=${roomId}, memberId=${memberId}, file=${latest.name}, size=${latest.size} bytes`);
  return { filePath: latest.filePath, mimeType: "audio/opus" };
}

/**
 * 记录采集开始日志
 */
export function logCollectionStart(roomId: string, memberId: string): void {
  console.log(`[audio-file-service] 开始采集: roomId=${roomId}, memberId=${memberId}, timestamp=${Date.now()}`);
}

/**
 * 记录采集结束日志
 */
export function logCollectionEnd(roomId: string, memberId: string, filePath: string, fileSize: number): void {
  console.log(`[audio-file-service] 结束采集: roomId=${roomId}, memberId=${memberId}, file=${path.basename(filePath)}, size=${fileSize} bytes`);
}

export const AudioFileService = {
  getLatestRecording,
  logCollectionStart,
  logCollectionEnd,
};

export default AudioFileService;
