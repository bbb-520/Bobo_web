import { isImageFile, validateAttachments } from './attachments';

export type ChatMode = 'chat' | 'text' | 'vision' | 'document' | 'image';
export type ActualChatMode = Exclude<ChatMode, 'chat'>;
export interface ChatModeContext { hasImages?: boolean; imageCount?: number; hasDocuments?: boolean; imageIntent?: 'GENERATE' | 'REMIX' | 'DESCRIBE'; }
export const CHAT_MODES: {id: ChatMode; label: string; description: string; placeholder: string}[] = [
  {id:'chat',label:'智能聊天',description:'自动选择文字、图片或文件问答；明确说“生成图片”会直接生图。',placeholder:'聊点什么，或添加图片与文件…'},
  {id:'text',label:'文本聊天',description:'文字问答与写作，不引用旧图片或文件；明确生图指令会自动转图片生成。',placeholder:'输入问题或写作要求…'},
  {id:'vision',label:'图片多模态',description:'识别、理解和比较图片，可继续追问；最多 3 张图片。',placeholder:'添加图片，问问其中的细节…'},
  {id:'document',label:'文件多模态',description:'总结文件、检索和问答，可搭配图片；支持沿用已上传文件追问。',placeholder:'添加文件，提问或总结内容…'},
  {id:'image',label:'图片生成',description:'输入文字生成一张图片；也可添加一张参考图进行编辑。',placeholder:'描述你想生成的画面…'},
];
export const MODE_LABELS: Record<ActualChatMode,string> = {text:'文本聊天',vision:'图片多模态',document:'文件多模态',image:'图片生成'};

/** Only the user's own explicit request can start image generation, never attachment contents. */
export function requestsImageGeneration(text: string): boolean {
  const value=text.trim();
  if(!value)return false;
  // Auto routing is a chargeable action: questions and requests for instructions/prompts stay in chat.
  if(/[?？]|(?:提示词|步骤|教程|原理|需要.{0,12}(?:条件|准备|什么)|如何|怎样|怎么)|\b(?:prompt|steps?|tutorial|how|requirements?)\b/i.test(value))return false;
  const instruction=value.split(/[：:\n]/,1)[0];
  const direct=instruction.replace(/^(?:(?:请你|请|麻烦你|麻烦|劳驾|帮我|帮忙|给我|我想要你|我希望你|我想要|我想)[，,\s]*)+/,'').replace(/^(?:(?:please|help me|could you|can you|would you|I want you to|I would like you to)\s+)+/i,'');
  if(/^(?:解释|介绍|分析|总结|讨论|告诉|教我|说说|回答)/.test(direct))return false;
  if(/(?:写|编写|提供|生成).{0,45}(?:代码|程序|示例|脚本)|(?:生图|生成图片|生成图像).{0,10}(?:步骤|教程|方法|原理)/i.test(instruction))return false;
  if(/^(?:explain|tell|teach|describe|summarize|debug)\b|\b(?:write|show|give)\b.{0,35}\b(?:code|program|example|tutorial|steps)\b/i.test(direct))return false;
  if(/(?:不想|不打算|不希望|无需|不能).{0,24}(?:生图|画|绘制|生成)|\b(?:don't|do not|doesn't|not|never|cannot|can't)\b.{0,45}\b(?:generate|create|make|draw|paint|render)\b/i.test(instruction))return false;
  if(/^(?:what|which|where|when|is|are|do|does)\b|\b(?:understand|learn|explain|know how|best way|how to)\b/i.test(direct))return false;
  if(/^(?:如何|怎样|怎么|为什么|解释|介绍|分析|总结|请解释|请介绍|请分析|请总结)/i.test(value))return false;
  if(/(?:不要|别|不需要|不必|禁止).{0,16}(?:生图|画|绘制|生成)/.test(value))return false;
  if(/(?:写|优化|润色|改写|提供).{0,35}(?:提示词|prompt)|(?:图片|图像|生图).{0,8}(?:失败|报错|怎么办)|^(?:你|系统|模型)(?:能|会|可以)(?:生成图片|生成图像|画图|生图)[吗么?？]*$/i.test(value))return false;
  if(/^(?:explain|how|why|do not|don't|never|describe how)\b|\b(?:write|improve|rewrite)\b.{0,30}\bprompt\b/i.test(value))return false;
  // Fail closed: quotations and discussions containing a generation verb are not commands.
  if(/翻译|translate/i.test(instruction)||!(/^(?:生成|创作|制作|绘制|画出|画|把|将|重绘|扩图|修图)/.test(direct)||/^(?:generate|create|make|draw|paint|render|sketch)\b/i.test(direct)))return false;
  return /(?:生成|创作|制作|绘制|画出|画).{0,35}(?:图片|图像|插画|海报|壁纸|头像|封面|图标|照片|漫画|绘画|logo)|(?:^|[，。！？\s])(?:请|帮我|请你|给我|麻烦|帮忙)*画(?:一|个|只|幅|张|两|几|出)|(?:把|将).{0,45}(?:做成|改成|转换成|变成|重绘为|改为).{0,25}(?:画|海报|图片|图像|插画|壁纸|头像|封面)|(?:重绘|扩图|修图)/i.test(value)
    || /\b(?:generate|create|make|draw|paint|render)\b.{0,45}\b(?:image|picture|photo|illustration|poster|wallpaper|logo|icon|painting|portrait)\b/i.test(value)
    || /^(?:please\s+)?(?:draw|paint|sketch)\b(?!.*\b(?:comparison|conclusion|parallel)\b)/i.test(value);
}

export function resolveChatMode(text: string, files: File[] = [], selected: ChatMode = 'chat', context: ChatModeContext = {}) {
  const images=files.filter(isImageFile),documents=files.filter(file=>!isImageFile(file));
  const generating=selected==='image'||context.imageIntent==='GENERATE'||context.imageIntent==='REMIX'||(context.imageIntent===undefined&&requestsImageGeneration(text));
  let mode:ActualChatMode=generating?'image':selected==='text'?'text':selected==='vision'?'vision':selected==='document'?'document':documents.length||context.hasDocuments?'document':images.length||context.hasImages?'vision':'text';
  const referenceFromContext=mode==='image'&&selected!=='text'&&!files.length&&Boolean(context.hasImages)
    &&(context.imageIntent==='REMIX'||(context.imageIntent===undefined&&/(?:这张|原图|参考图|该图|上(?:一张|传的)(?:图片|照片|图)|this (?:image|photo)|reference image)/i.test(text)));
  const useImages=mode!=='text'&&(mode!=='image'||referenceFromContext);
  const useDocuments=mode==='document';
  let error=validateAttachments(files,mode==='image'?'image':'chat')??undefined;
  if(!error&&selected==='text'&&files.length)error='文本聊天只接收文字，请切换到智能聊天、图片多模态或文件多模态。';
  if(!error&&mode==='image'&&!files.length&&!text.trim())error='请输入想要生成的图片内容，或添加一张参考图片。';
  if(!error&&referenceFromContext&&(context.imageCount??1)>1)error='当前有多张图片，请选择一张参考图片再生成。';
  if(!error&&mode==='vision'&&documents.length)error='图片多模态只接收图片，请切换到文件多模态或智能聊天。';
  if(!error&&mode==='vision'&&!images.length&&!context.hasImages)error='请先添加图片，再进行识别或提问。';
  if(!error&&mode==='document'&&!documents.length&&!context.hasDocuments)error='请先添加文件，再进行概要或问答。';
  return {mode,kind:mode==='image'?'image' as const:'chat' as const,capability:mode==='image'?'IMAGE' as const:mode==='vision'||(mode==='document'&&(images.length||context.hasImages))?'VISION' as const:'CHAT' as const,
    automatic:generating&&selected!=='image',useImages,useDocuments,referenceFromContext,error};
}

/** Image-context auto routing uses the server classifier, never local edit keywords. */
export function needsImageIntent(text: string, files: File[], selected: ChatMode, context: ChatModeContext = {}): boolean {
  return Boolean(text.trim() && (selected==='chat'||selected==='vision')
    && !files.some(file=>!isImageFile(file)) && !(selected==='chat'&&context.hasDocuments)
    && (files.some(isImageFile)||context.hasImages));
}
