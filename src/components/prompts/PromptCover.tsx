import { useEffect,useId,useState } from 'react';
import type { PromptEntry } from '../../lib/promptLibrary';

function family(category:string):string {
  if(/typography|brand|events/.test(category))return 'poster';
  if(/photography|cinematic-film|beauty|fashion/.test(category))return 'film';
  if(/watercolor|fine-art|ink/.test(category))return 'botanical';
  if(/isometric|architecture/.test(category))return 'space';
  if(/product|official/.test(category))return 'still';
  if(/pixel|gaming|retro/.test(category))return 'pixel';
  if(/anime|character|illustration|tattoo|cinematic-and/.test(category))return 'character';
  return 'diagram';
}
/** Original lightweight illustrative covers. They are not model output previews. */
export default function PromptCover({entry,imageUrl}:{entry:PromptEntry;imageUrl?:string}) {
  const [failed,setFailed]=useState(false);const uid=useId().replace(/:/g,'');
  useEffect(()=>setFailed(false),[imageUrl]);
  const seed=[...entry.id].reduce((value,letter)=>(value*31+letter.charCodeAt(0))>>>0,0),kind=family(entry.category);
  const colors=[['#4058c8','#dce7fa','#f8a15a'],['#efbb6f','#f6e6d0','#a94b58'],['#799c86','#e8e7c4','#d77356'],['#c0798d','#f2dbe0','#638798']][seed%4];
  const [main,pale,accent]=colors;
  return <div className={`prompt-cover cover-${kind}`}>
    {imageUrl&&!failed?<img src={imageUrl} alt="提示词参考封面" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<svg viewBox="0 0 600 750" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`sky-${uid}`} x2="0" y2="1"><stop stopColor={pale}/><stop offset="1" stopColor={main}/></linearGradient>
        <linearGradient id={`glass-${uid}`} x2="1" y2="0"><stop stopColor="#e6e8db"/><stop offset=".45" stopColor="#ffffff"/><stop offset="1" stopColor="#afb9ab"/></linearGradient>
        <radialGradient id={`paint-${uid}`}><stop stopColor={main} stopOpacity=".85"/><stop offset=".8" stopColor={main} stopOpacity=".55"/><stop offset="1" stopColor={main} stopOpacity=".1"/></radialGradient>
      </defs>
      {kind==='poster'&&<>
        <rect width="600" height="750" fill={main}/><circle cx="570" cy="130" r="250" fill={accent}/>
        <path d="M-70 620 520-70M-20 780 640 0" stroke={pale} strokeWidth="3" opacity=".8"/>
        <text x="44" y="180" fontSize="100" fontFamily="Arial,sans-serif" fontWeight="800" fill={pale}>MAKE</text>
        <text x="43" y="284" fontSize="100" fontFamily="Arial,sans-serif" fontWeight="800" fill={pale}>IT</text>
        <text x="43" y="390" fontSize="100" fontFamily="Arial,sans-serif" fontWeight="800" fill={pale}>FEEL.</text>
        <ellipse cx="320" cy="504" rx="218" ry="74" fill="none" stroke={pale} strokeWidth="8" transform="rotate(-16 320 504)"/>
        <text x="190" y="518" fontSize="34" fontFamily="Georgia,serif" fontStyle="italic" fill={pale}>a little different</text>
        <path d="M44 650H556" stroke={pale}/><circle cx="540" cy="680" r="10" fill={accent}/>
      </>}
      {kind==='film'&&<>
        <rect width="600" height="750" fill="#242c31"/><rect x="30" y="30" width="540" height="690" fill={`url(#sky-${uid})`}/>
        <circle cx="450" cy="196" r="82" fill="#f8dd99"/><path d="m30 470 175-235 125 185 100-108 140 195v213H30Z" fill="#6b7b76"/>
        <path d="m30 550 155-132 145 131 145-85 95 109v147H30Z" fill="#334c4e"/>
        <path d="M160 720C250 600 430 680 346 548" fill="none" stroke="#d6cba2" strokeWidth="24"/>
        <path d="M50 60h60M50 60v60M550 60h-60M550 60v60M50 690h60M50 690v-60M550 690h-60M550 690v-60" stroke="#f4e9d7" strokeWidth="2" opacity=".7"/>
        {[0,1,2,3,4,5].map(i=><g key={i}><rect x="8" y={70+i*108} width="11" height="44" rx="3" fill="#e5ddc8"/><rect x="581" y={70+i*108} width="11" height="44" rx="3" fill="#e5ddc8"/></g>)}
      </>}
      {kind==='botanical'&&<>
        <rect width="600" height="750" fill="#eee9df"/>
        <ellipse cx="300" cy="360" rx="232" ry="252" fill={`url(#paint-${uid})`} opacity=".3"/>
        <path d="M290 690Q330 440 260 210M306 535 420 370M285 390 176 295" fill="none" stroke="#4e6e57" strokeWidth="8"/>
        <ellipse cx="405" cy="400" rx="92" ry="33" fill={main} transform="rotate(-36 405 400)" opacity=".85"/>
        <ellipse cx="200" cy="320" rx="87" ry="31" fill="#728b64" transform="rotate(33 200 320)" opacity=".8"/>
        <ellipse cx="330" cy="580" rx="86" ry="29" fill={main} transform="rotate(-30 330 580)" opacity=".8"/>
        {[0,1,2,3,4].map(i=><ellipse key={i} cx="260" cy="182" rx="45" ry="90" fill={accent} opacity=".65" transform={`rotate(${i*72} 260 245)`}/>)}
        <circle cx="260" cy="245" r="27" fill="#d6af5c"/><path d="M58 68h484v614H58Z" fill="none" stroke="#9f9b8b" opacity=".45"/>
      </>}
      {kind==='space'&&<>
        <rect width="600" height="750" fill={pale}/><path d="m30 540 270-156 270 156-270 156Z" fill={main} opacity=".32"/>
        <path d="m140 480 160-94 160 94-160 94Z" fill="#f9f3dd"/><path d="m140 480 160 94v100l-160-94Z" fill="#d2c5ac"/><path d="m300 574 160-94v100l-160 94Z" fill="#b8b29e"/>
        <path d="m150 310 150-85 150 85v176l-150 86-150-86Z" fill="#fff5df"/>
        <path d="m300 397 150-87v176l-150 86Z" fill="#d2c7b5"/>
        <path d="m130 314 170-150 170 150-170 100Z" fill={accent}/><path d="m130 314 170 100 170-100v24L300 438 130 338Z" fill={main}/>
        <path d="m187 374 55 32v94l-55-32Z" fill="#71949b"/><path d="m336 416 56-33v95l-56 33Z" fill="#71949b"/>
        <path d="m390 592 32-18v60l-32 18Z" fill="#736b56"/><circle cx="416" cy="552" r="46" fill="#7a9974"/><circle cx="434" cy="518" r="32" fill="#a2b684"/>
        <circle cx="125" cy="546" r="30" fill="#90a67b"/><rect x="120" y="551" width="9" height="54" fill="#7f735e"/>
      </>}
      {kind==='still'&&<>
        <rect width="600" height="750" fill={pale}/><circle cx="470" cy="150" r="220" fill={main} opacity=".25"/>
        <path d="M0 536h600v214H0Z" fill={main}/><ellipse cx="309" cy="572" rx="173" ry="35" fill="#101d2d" opacity=".18"/>
        <rect x="187" y="220" width="226" height="350" rx="45" fill={`url(#glass-${uid})`}/><rect x="236" y="150" width="128" height="86" rx="12" fill="#424841"/>
        <path d="M214 270h171v201H214Z" fill="#f6f1df"/><text x="245" y="330" fill="#3d5044" fontSize="34" fontFamily="Georgia,serif">bloom</text>
        <path d="M300 436v-76M300 405q-55 0-55-36 55 0 55 36M300 383q49 0 49-34-49 0-49 34" fill="none" stroke="#688461" strokeWidth="5"/>
        <path d="M116 588q0-145 94-189M122 529q-87-37-71-94 73 0 71 94" fill="none" stroke="#3b5e44" strokeWidth="9"/>
      </>}
      {kind==='pixel'&&<>
        <rect width="600" height="750" fill="#282b4f"/>
        {[70,180,310,455,530].map((x,i)=><path key={x} d={`M${x} ${85+i%3*48}h14v14h14v14h-14v14h-14v-14h-14v-14h14Z`} fill={pale}/>)}
        <path d="M0 430h70v-70h65v-50h75v50h60v70h75v-45h70v-75h70v45h115v395H0Z" fill={main}/>
        <path d="M0 580h90v-55h65v45h110v-70h70v45h85v-50h90v55h90v200H0Z" fill="#79a893"/>
        <path d="M0 660h600v90H0Z" fill="#dbb47e"/><path d="M235 750v-45h45v-45h45v-45h45v-45h45" stroke="#eef2d0" strokeWidth="30" fill="none"/>
        <path d="M82 515h24v-48h-18v-25h-24v25H46v48h24v50h12Z" fill="#cddc95"/>
        <rect x="430" y="404" width="72" height="48" fill={accent}/><rect x="444" y="390" width="42" height="14" fill={accent}/><rect x="442" y="419" width="12" height="12" fill="#282b4f"/>
      </>}
      {kind==='character'&&<>
        <rect width="600" height="750" fill={pale}/><circle cx="330" cy="290" r="220" fill={main}/>
        <path d="M78 750q20-243 220-245 226-4 240 245Z" fill={accent}/><path d="m232 500 65 99 77-94-25 245H247Z" fill="#f6e9cf"/>
        <path d="M180 303q-12-177 124-183 156-3 143 183l-33 114q-53 104-116 94-91-11-109-109Z" fill="#efc8a3"/>
        <path d="M180 327q-64-154 47-210 112-60 184 36 83 64 41 180l-44-106q-135 50-154-42-34 72-74 142Z" fill="#283238"/>
        <path d="m217 318 55-6m68 0 55 8" stroke="#263039" strokeWidth="14"/>
        <circle cx="250" cy="343" r="8" fill="#263039"/><circle cx="365" cy="343" r="8" fill="#263039"/>
        <path d="m310 344-10 53 24 3M275 432q34 25 65-2" fill="none" stroke="#a67257" strokeWidth="7" strokeLinecap="round"/>
        <path d="M83 135 136 91M475 420l54-26M465 98l32-43" stroke={accent} strokeWidth="12"/>
      </>}
      {kind==='diagram'&&<>
        <rect width="600" height="750" fill={pale}/><path d="M60 70h480v600H60Z" fill="#fff" opacity=".7"/>
        <path d="M100 138h195M100 160h116" stroke={main} strokeWidth="10"/>
        <path d="M300 242v90m0 0-135 95m135-95 135 95M165 427v118m270-118v118" fill="none" stroke={main} strokeWidth="5"/>
        <circle cx="300" cy="247" r="58" fill={accent}/><circle cx="165" cy="427" r="52" fill={main}/><circle cx="435" cy="427" r="52" fill={main}/>
        <rect x="103" y="548" width="124" height="57" rx="12" fill={accent}/><rect x="373" y="548" width="124" height="57" rx="12" fill={accent}/>
        <path d="M276 246h48m-24-24v48M145 427h40M415 427h40" stroke="#fff9ed" strokeWidth="5"/>
      </>}
    </svg>}
    <span className="prompt-cover-label">{imageUrl&&!failed?'参考封面':'风格示意'}</span>
  </div>;
}
