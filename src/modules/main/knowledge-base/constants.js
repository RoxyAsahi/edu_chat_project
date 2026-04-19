const KB_UNSUPPORTED_OCR_ERROR = '当前 KB 无法处理该来源文件';
const KB_IMAGE_TRANSCRIPTION_PENDING_ERROR = '当前图片来源尚未完成转录，请稍后再试';
const DEFAULT_KB_EMBEDDING_MODEL = 'BAAI/bge-m3';
const DEFAULT_KB_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';
const DEFAULT_KB_TOP_K = 6;
const DEFAULT_KB_CANDIDATE_TOP_K = 20;
const DEFAULT_KB_SCORE_THRESHOLD = 0.25;
const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 50;
const SUPPORTED_TEXT_MIME_PREFIX = 'text/';
const SUPPORTED_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/json',
    'application/xml',
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'text/css',
]);
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/bmp',
]);

module.exports = {
    KB_UNSUPPORTED_OCR_ERROR,
    KB_IMAGE_TRANSCRIPTION_PENDING_ERROR,
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
    DEFAULT_KB_TOP_K,
    DEFAULT_KB_CANDIDATE_TOP_K,
    DEFAULT_KB_SCORE_THRESHOLD,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CHUNK_OVERLAP,
    SUPPORTED_TEXT_MIME_PREFIX,
    SUPPORTED_MIME_TYPES,
    SUPPORTED_IMAGE_MIME_TYPES,
};
