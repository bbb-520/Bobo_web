/** 与后端 ChatEventTypeEnum 对齐的事件类型。 */
export const EVENT = {
  /** 数据事件：eventData 为最终回答文本增量 */
  DATA: 1001,
  /** 停止事件：eventData 为 null，正常/主动停止路径的收尾 */
  STOP: 1002,
  /** 参数事件（预留，后端不发，收到应忽略） */
  PARAM: 1003,
  /** 错误事件：eventData 为错误描述，也是流的终结信号 */
  ERROR: 1004,
  /** 模型决定调用某个工具：eventData 为 ToolCallStartedData */
  TOOL_CALL_STARTED: 1005,
  /** 工具返回结果：eventData 为 ToolCallResultData */
  TOOL_CALL_RESULT: 1006,
  /** 模型思考摘要：eventData 为纯文本（工具调用前，可能多条） */
  REASONING: 1007,
  /** 工具调用失败：eventData 为 ToolCallFailedData，失败后流仍会继续 */
  TOOL_CALL_FAILED: 1008,
  /** Token 用量与耗时事件，当前界面忽略。 */
  USAGE: 1009,
  /** 会话元信息：eventData 为 SessionInfoData，流内第一条事件 */
  SESSION_INFO: 1010,
  /** 图片后台任务：eventData 为 ImageJobEventData */
  IMAGE_JOB: 1011,
  SCENE_CARD: 1012,
  WAITING_FOR_INSTRUCTION: 1013,
  GENERATION_CREATED: 1014,
  ANSWER_REPLACE: 1015,
  FALLBACK_STARTED: 1016,
  MODEL_STATUS: 1017,
} as const;

/** SSE 中一条 `data:` 对应的原始结构：{"eventType":1001,"eventData":"..."} */
export interface ChatEvent {
  eventType: number;
  eventData: unknown;
}

/* ---------- 各事件 eventData 的类型 ---------- */

/** 1005 TOOL_CALL_STARTED */
export interface ToolCallStartedData {
  /** 该次调用的唯一 ID（可能为空串） */
  toolCallId?: string;
  toolName: string;
  /** 模型下发的参数，原始 JSON 字符串 */
  arguments?: string;
}

/** 1006 TOOL_CALL_RESULT */
export interface ToolCallResultData {
  toolName: string;
  /** 工具返回摘要，超长时后端截断为 500 字符并追加 …(已截断) */
  result: string;
}

/** 1008 TOOL_CALL_FAILED */
export interface ToolCallFailedData {
  toolName: string;
  error: string;
}

/** 1010 SESSION_INFO */
export interface SessionInfoData {
  conversationId: string;
  timestamp: number;
}

export type ImageJobStatus = 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED';

export interface ImageAttachment {
  assetId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** 当前浏览器会话中用于立即展示用户图片的本地对象地址。 */
  previewUrl?: string;
}

export interface DocumentAttachment {
  documentId?:string;requestId:string;fileName:string;mimeType:string;fileSize:number;
  status:string;percent?:number;completedChunks?:number;chunkCount?:number;error?:string;
}

export interface ImageJobEventData {
  jobId: string;
  status: ImageJobStatus;
  mode?: string;
  createdAt?: string;
}

export interface SceneCardEventData {
  summary: string;
  subjects?: string[];
  palette?: string;
  composition?: string;
  mood?: string;
  sourceAssetId?: string;
}

export interface ImageJobRef {
  requestId?:string|null;
  jobId: string;
  status: ImageJobStatus;
  mode?: string;
  prompt?: string;
  createdAt?: string;
  completedAt?: string | null;
  imageUrl?: string | null;
  rationale?: string | null;
  error?: string | null;
}

export type Role = 'user' | 'assistant';

export type MsgStatus = 'streaming' | 'done' | 'stopped' | 'error';

/** 一轮结束原因：stop=正常 / error=错误 / stopped_by_user=用户中断 / aborted=连接异常 */
export type EndReason = 'stop' | 'error' | 'stopped_by_user' | 'aborted';

/** 工具调用卡片的本地状态 */
export type ToolStatus = 'running' | 'ok' | 'failed' | 'stopped';

/** 助手消息内一张「工具调用」卡片。 */
export interface ToolCallItem {
  /** 前端本地唯一 ID（用于 React key） */
  localId: string;
  /** 后端下发的 toolCallId（可能为空串） */
  toolCallId?: string;
  toolName: string;
  /** 入参原始 JSON 字符串 */
  argumentsRaw?: string;
  status: ToolStatus;
  /** 1006 返回摘要 */
  result?: string;
  /** 1008 失败原因 */
  error?: string;
}

export interface ChatMsg {
  selectedMode?:import('./lib/chatModes').ChatMode;
  mode?:import('./lib/chatModes').ActualChatMode;
  automaticMode?:boolean;
  imageRequest?:{requestId:string;conversationId:string;prompt:string;attachments?:ImageAttachment[];state:'uploading'|'submitting'|'accepted'|'stopped'|'failed';stopRequested?:boolean};
  modelStatus?: import('./lib/modelStatus').ModelStatus;
  id: string;
  role: Role;
  /** 最终回答（仅 DATA 增量拼接），不含思考/工具过程文本 */
  content: string;
  status?: MsgStatus;
  error?: string;
  /** 工具调用卡片列表（1005/1006/1008 驱动） */
  toolCalls?: ToolCallItem[];
  /** 后端会话键（1010 SESSION_INFO 提供） */
  conversationId?: string;
  /** 本轮结束原因。 */
  endReason?: EndReason;
  createdAt: number;
  /** 助手消息：开始生成的时间戳 */
  startedAt?: number;
  /** 助手消息：生成结束（完成/停止/出错）的时间戳 */
  finishedAt?: number;
  /** 用户上传图片的元数据，不保存二进制或 data URL。 */
  attachments?: ImageAttachment[];
  documentAttachments?:DocumentAttachment[];
  attachmentPreparation?:{state:'preparing'|'failed'|'stopped';error?:string;assistantId:string;classifyIntent?:boolean};
  /** 后台图片任务，仅保存任务 ID 和状态。 */
  imageJobs?: ImageJobRef[];
  sceneCard?: SceneCardEventData;
  waitingForInstruction?: boolean;
  zineRequestId?: string;
  zineResult?: import('./lib/zine').ZineResult;
  execution?: import('./api/executions').ExecutionView;
  executionConnection?: string;
}

/** 一个会话 = 一个后端 sessionId（记忆上下文），加上本地持久化的消息列表 */
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMsg[];
  createdAt: number;
  updatedAt: number;
  imageAttachments?:ImageAttachment[];
  documentConversationId?:string;
  documentIds?:string[];
  indexVersions?:Record<string,number>|number[];
}

export interface Settings {
  /** 后端地址；留空 = 同源（开发时可走 Vite 代理 /api，生产时由 Node 代理 /api）。 */
  baseUrl: string;
  theme: 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  // 开发时走 Vite /api 代理，浏览器看到的是同源请求，HttpOnly 登录 Cookie
  // 刷新后可以稳定回传；生产时由 Node 提供静态页并代理 /api。
  baseUrl: '',
  theme: 'light',
};

export const SUGGESTIONS: { icon: string; title: string; desc: string; ask: string }[] = [
  {
    icon: '✦',
    title: '纸刊海报',
    desc: '把照片做成一张安静的复古纸刊海报',
    ask: '把这张照片做成一张安静的复古纸刊海报',
  },
  {
    icon: '◌',
    title: '换一层气氛',
    desc: '保留人物，把背景换成柔和的黄昏纸张',
    ask: '保留人物和姿态，把背景换成柔和的黄昏纸张',
  },
  {
    icon: '⌁',
    title: '提取情绪',
    desc: '不保留原图，只提取照片的情绪和色彩',
    ask: '不要保留原图，只提取这张照片的情绪和色彩重新创作',
  },
];
