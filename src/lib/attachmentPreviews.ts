import { apiRequest } from './http';
export interface AssetPreview { assetId:string; previewUrl:string; expiresAt:string; }
export async function fetchAssetPreview(assetId:string,baseUrl:string,signal?:AbortSignal):Promise<AssetPreview> {
  const result=await apiRequest<AssetPreview>(baseUrl,`/api/image-assets/${encodeURIComponent(assetId)}/preview`,{signal});
  if(result.assetId!==assetId||typeof result.previewUrl!=='string'||!/^https?:\/\//.test(result.previewUrl))throw Error('图片预览暂不可用');
  return result;
}
