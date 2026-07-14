import { OpenAIProvider } from "./providers/OpenAIProvider.js";
import { ConversationManager } from "./conversation/ConversationManager.js";

const timeout=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener("abort",()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"))},{once:true})});

export class AIClient{
  constructor(getSettings){
    this.getSettings=getSettings;
    this.localReplyCounter=0;
    this.recentLocalReplies=[];
  }

  hasProviderConfig(settings){return Boolean(settings.aiBaseURL||settings.aiApiKey||settings.aiModel)}

  createProvider(settings){
    return new OpenAIProvider({
      baseURL:settings.aiBaseURL,
      apiKey:settings.aiApiKey,
      model:settings.aiModel,
      temperature:settings.aiTemperature,
      maxTokens:settings.aiMaxTokens,
      stream:settings.aiStream
    });
  }

  createSystemPrompt(settings,memories=[]){
    const assistant=settings.assistantName||"暮曦";
    const user=settings.userName||"用户";
    const memoryText=memories.length?memories.map(item=>`- ${item.content}`).join("\n"):"- 暂无";
    return `你是手机语音助手${assistant}。你正在和${user}对话。请使用简短、自然、温和的中文，不要播音腔，不要长篇说教。可以使用提供的长期记忆，但不能编造不存在的记忆。\n长期记忆：\n${memoryText}`;
  }

  async reply({messages,memories=[],signal}){
    const settings=this.getSettings();
    if(settings.remoteAI){
      if(this.hasProviderConfig(settings))return this.providerReply(settings,messages,memories,signal);
      if(settings.apiEndpoint)return this.legacyProxyReply(settings,messages,memories,signal);
      throw new Error("请先在设置中填写 AI 模型配置");
    }
    await timeout(420+Math.random()*420,signal);
    return this.localReply(messages.at(-1)?.content||"",memories,settings,messages);
  }

  async providerReply(settings,messages,memories,signal){
    const manager=new ConversationManager({contextLimit:settings.contextLimit||20});
    const context=manager.build({
      messages,
      systemPrompt:this.createSystemPrompt(settings,memories)
    });
    return this.createProvider(settings).chat({messages:context,signal});
  }

  async legacyProxyReply(settings,messages,memories,signal){
    let response;
    try{
      response=await fetch(settings.apiEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({assistantName:settings.assistantName,userName:settings.userName,messages:messages.slice(-24).filter(message=>message.status!=="error").map(({role,content})=>({role,content})),memories:memories.map(({type,content})=>({type,content}))}),signal});
    }catch(error){
      if(error?.name==="AbortError")throw error;
      throw new Error("网络异常，请检查代理地址或网络");
    }
    if(!response.ok)throw new Error(`大模型接口返回错误（${response.status}）`);
    const data=await response.json();
    const content=data.reply||data.content||data.choices?.[0]?.message?.content;
    if(!content)throw new Error("大模型接口没有返回有效回复");
    return String(content).trim();
  }

  async testConnection(){
    const settings=this.getSettings();
    if(this.hasProviderConfig(settings)){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),12000);
      try{return await this.createProvider(settings).testConnection({signal:controller.signal})}
      catch(error){if(error?.name==="AbortError")throw new Error("连接超时，请检查 Base URL 或网络");throw error}
      finally{clearTimeout(timer)}
    }
    if(settings.apiEndpoint){
      const healthURL=settings.apiEndpoint.replace(/\/chat\/?(?:\?.*)?$/,"/health");
      const response=await fetch(healthURL,{headers:{Accept:"application/json"}});
      if(!response.ok)throw new Error(`连接失败（${response.status}）`);
      const data=await response.json();
      if(data.modelConfigured===false)throw new Error("代理已连接，但模型尚未配置");
      return "OK";
    }
    throw new Error("请先填写 Base URL、API Key 和模型名称");
  }

  pickLocalReply(options,seed=""){
    const replies=options.filter(Boolean);
    if(!replies.length)return"嗯，我在听。";
    let hash=0;
    for(const char of String(seed))hash=(hash*31+char.charCodeAt(0))>>>0;
    let index=(hash+this.localReplyCounter++)%replies.length;
    for(let offset=0;offset<replies.length;offset+=1){
      const candidate=replies[(index+offset)%replies.length];
      if(!this.recentLocalReplies.includes(candidate)){index=(index+offset)%replies.length;break}
    }
    const reply=replies[index];
    this.recentLocalReplies.push(reply);
    this.recentLocalReplies=this.recentLocalReplies.slice(-3);
    return reply;
  }

  cleanTopic(text){
    return String(text).replace(/[\r\n]+/g," ").replace(/\s+/g," ").trim().slice(0,22);
  }

  memorySummary(memories){
    return memories.slice(0,5).map(item=>item.content).join("；");
  }

  normalizeLocalText(text){
    return String(text||"").replace(/[\r\n]+/g," ").replace(/\s+/g," ").trim();
  }

  detectLocalIntent(text){
    const value=this.normalizeLocalText(text);
    if(!value)return"empty";
    if(/^(早上好|早安|早呀|晚上好|晚安|你好|嗨|哈喽|hello|hi|在吗|有人吗)[呀啊吗呢。！!？?\s]*$/i.test(value))return"greeting";
    if(/现在几点|几点了|几点[？?。!！\s]*$|什么时间|当前时间|时间多少|^时间[？?。!！\s]*$|现在(?:是|[：:])?\s*\d{1,2}[：:]\d{2}/.test(value))return"time";
    if(/今天几号|今天是几号|今天日期|今天星期|星期几|什么日子|日期|明天几号|昨天几号|(?:今天|明天|昨天)(?:是|[：:]).*(?:年|月|日|星期)/.test(value))return"date";
    if(/你是谁|你叫什么|你的名字|自我介绍|你是干嘛的|^身份[？?。!！\s]*$/.test(value))return"identity";
    if(/哪个版本|什么版本|版本号/.test(value))return"version";
    if(/怎么用|如何使用|使用方法|帮助|帮帮我|你会什么|能做什么|可以做什么/.test(value))return"help";
    if(/忘记|删除记忆|清除记忆|不要记/.test(value))return"memoryDelete";
    if(/你记得什么|记住了什么|还记得|我记得|我的偏好|关于我的记忆|你记得我吗|^记忆[？?。!！\s]*$/.test(value))return"memoryRecall";
    if(/(?:请)?记住|别忘了|我喜欢|我不喜欢|以后叫我|我叫/.test(value))return"memoryWrite";
    if(/语音播报|自动播报|声音设置|语速|说话声音/.test(value))return"voiceSettings";
    if(/麦克风|语音输入|不能说话|听不到我/.test(value))return"microphone";
    if(/聊天记录|历史记录|以前的对话/.test(value))return"chatHistory";
    if(/大模型|远程模型|API|接口|Base URL|模型设置/i.test(value))return"modelSettings";
    if(/设置在哪|设置在哪里|怎么设置|如何设置|打开设置|进入设置|^设置[？?。!！\s]*$/.test(value))return"settings";
    if(/心情不好|难过|不开心|烦死|好烦|累了|好累|压力大/.test(value))return"emotionNegative";
    if(/开心|高兴|太好了|好棒/.test(value))return"emotionPositive";
    if(/谢谢|多谢|感谢/.test(value))return"thanks";
    if(/再见|拜拜|先这样|我走了|睡了/.test(value))return"goodbye";
    if(/你好吗|你怎么样|在干嘛/.test(value))return"status";
    return"unknown";
  }

  buildLocalContext(messages,currentText){
    const safeMessages=Array.isArray(messages)?messages.filter(message=>message?.content&&message.status!=="error"):[];
    const current=this.normalizeLocalText(currentText);
    let currentIndex=safeMessages.length;
    for(let index=safeMessages.length-1;index>=0;index-=1){
      const message=safeMessages[index];
      if(message.role==="user"&&this.normalizeLocalText(message.content)===current){currentIndex=index;break}
    }

    const previousUsers=[];
    let previousAssistantText="";
    for(let index=currentIndex-1;index>=0;index-=1){
      const message=safeMessages[index];
      if(!previousAssistantText&&message.role==="assistant")previousAssistantText=this.normalizeLocalText(message.content);
      if(message.role==="user")previousUsers.push(this.normalizeLocalText(message.content));
      if(previousUsers.length>=6&&previousAssistantText)break;
    }

    const previousText=previousUsers[0]||"";
    const previousIntent=this.detectLocalIntent(previousText);
    const assistantIntent=this.detectLocalIntent(previousAssistantText);
    const anchor=previousUsers.map(item=>({text:item,intent:this.detectLocalIntent(item)})).find(item=>item.intent!=="unknown"&&item.intent!=="empty");
    const effectiveIntent=previousIntent!=="unknown"&&previousIntent!=="empty"?previousIntent:assistantIntent!=="unknown"&&assistantIntent!=="empty"?assistantIntent:anchor?.intent||"unknown";
    return{
      previousText,
      previousTopic:this.cleanTopic(previousText),
      previousIntent,
      previousAssistantText,
      effectiveIntent,
      anchorText:anchor?.text||previousText
    };
  }

  formatLocalDate(dayOffset=0){
    const date=new Date();
    date.setDate(date.getDate()+dayOffset);
    return new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(date);
  }

  contextualReply(text,context,memories,settings){
    const value=this.normalizeLocalText(text);
    if(!context.previousText)return null;
    const assistant=settings.assistantName||"暮曦";
    const seed=`${context.previousText}|${value}`;
    const choose=(options)=>this.pickLocalReply(options,seed);

    if(/刚才.*(?:说|问).*(?:什么|啥)|之前.*(?:说|问).*(?:什么|啥)|我们聊到哪|上一个问题|前面说了什么/.test(value)){
      return choose([`你刚才说的是“${context.previousTopic}”。我们可以从这里继续。`,`上一句你提到“${context.previousTopic}”。你想接着聊哪一部分？`,`我们刚才聊到“${context.previousTopic}”。我还记得这一轮对话。`]);
    }

    if(context.effectiveIntent==="time"&&/^(那|那么)?(日期|今天几号|星期几|今天呢|那呢|呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      const date=this.formatLocalDate();
      return choose([`如果你是接着问日期，今天是${date}。`,`今天是${date}。`,`日期也告诉你：今天是${date}。`]);
    }
    if(context.effectiveIntent==="date"&&/^(那|那么)?(时间|几点|现在呢|那呢|呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      const time=new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date());
      return choose([`如果你是接着问时间，现在是${time}。`,`现在是${time}。`,`时间也告诉你：现在${time}。`]);
    }
    if(context.effectiveIntent==="date"&&/^(那|那么)?明天呢[呀啊吗。！!？?\s]*$/.test(value)){
      return choose([`明天是${this.formatLocalDate(1)}。`,`接着说日期的话，明天是${this.formatLocalDate(1)}。`]);
    }
    if(context.effectiveIntent==="date"&&/^(那|那么)?昨天呢[呀啊吗。！!？?\s]*$/.test(value)){
      return choose([`昨天是${this.formatLocalDate(-1)}。`,`往前一天的话，昨天是${this.formatLocalDate(-1)}。`]);
    }

    if(context.effectiveIntent==="memoryRecall"&&/^(还有呢|还有吗|就这些吗|其他呢|然后呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      const remaining=memories.slice(5,8).map(item=>item.content).join("；");
      if(remaining)return choose([`还有这些：${remaining}。`,`另外我还记得：${remaining}。`]);
      return choose(["目前我能找到的就是这些。以后你让我记住新内容，我会继续补上。","这一轮能查到的记忆都说完了。你也可以到“记忆”页面查看全部内容。"]);
    }
    if(["memoryRecall","memoryWrite","memoryDelete"].includes(context.effectiveIntent)&&/^(那|那么)?(怎么删|如何删|能删除吗|在哪里删|删掉它)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose(["可以删除。打开下方“记忆”页面，找到对应内容后点右侧 ×。","去“记忆”页面点那条内容右边的 ×，就能删掉。"]);
    }

    if(["settings","voiceSettings","microphone"].includes(context.effectiveIntent)&&/^(在哪里|哪儿|怎么开|怎么弄|然后呢|那呢|找不到)[呀啊吗呢。！!？?\s]*$/.test(value)){
      if(context.effectiveIntent==="voiceSettings")return choose(["点右下角“设置”，在“语音与记忆”里找到“自动语音播报”开关。","入口在右下角“设置”，打开“自动语音播报”就行。"]);
      if(context.effectiveIntent==="microphone")return choose(["回到聊天页，点输入框旁的麦克风；浏览器询问权限时选择允许。","麦克风在聊天输入框旁边。第一次使用时记得允许麦克风权限。"]);
      return choose(["点底部最右边的“设置”就能进去。","入口就在右下角，名称是“设置”。"]);
    }
    if(context.effectiveIntent==="chatHistory"&&/^(那|那么)?(怎么删|如何删除|怎么清空|能清空吗)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose(["可以。在设置页点“删除聊天记录”，也可以在聊天页新建对话。","想清空当前记录，可以去设置页删除；只想开始另一段对话，就点“新建聊天”。"]);
    }
    if(context.effectiveIntent==="modelSettings"&&/^(那|那么)?(要配置吗|必须配置吗|不配置呢|本地呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose(["使用本地对话不需要配置。只有你主动打开远程 AI 时，才需要填写接口信息。","本地模式可以直接用，不填 Base URL、API Key 和模型名称也没关系。"]);
    }

    if(context.effectiveIntent==="help"&&/^(还有呢|还有吗|然后呢|就这些吗|其他呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose(["还有聊天记录恢复、新建对话、长期记忆管理和本地设置。你可以直接问其中一项。","我也能接着上一轮聊天、回答时间日期、管理本地记忆，并把回复读出来。"]);
    }
    if(context.effectiveIntent==="identity"&&/^(那|那么)?(你会什么|能做什么|还有呢|然后呢|那呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose([`我是${assistant}，还可以接收语音、播报回复、保存聊天，并在本地记住你的偏好。`,`除了陪你聊天，我还能做语音输入、语音播报、聊天记录和长期记忆。`]);
    }

    if(/^(那你呢|你呢)[呀啊吗。！!？?\s]*$/.test(value)){
      if(context.effectiveIntent==="emotionNegative")return choose(["我还好。现在更想陪你把刚才的不舒服慢慢说清楚。","我在这里，状态挺稳的。你不用照顾我，先顾好自己。"]);
      if(context.effectiveIntent==="emotionPositive")return choose(["我也挺好的。听见你开心，我这边也轻松了一点。","我在呀，也被你刚才的好心情带动了。"]);
      return choose(["我还好，一直在这里听你说。","我挺好的。更想知道你接下来想聊什么。"]);
    }
    if(context.effectiveIntent==="emotionNegative"&&/^(不知道|不想说|没事|算了|嗯|是啊|对啊|怎么办|然后呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose(["没关系，不知道从哪说也可以。先告诉我，是身体累，还是心里更累？","那就先不勉强自己说清楚。我陪你停一会儿。","嗯，我还在。你可以只说一件现在最难受的小事。"]);
    }
    if(context.effectiveIntent==="emotionPositive"&&/^(嗯|是啊|对啊|真的|没错)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose(["嗯，那就让这份好心情多待一会儿。","真好。愿意的话，也可以告诉我是什么让你这么开心。"]);
    }

    if(/^(不是|不对|你理解错了)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose([`明白，是我把“${context.previousTopic}”理解偏了。你换个说法，我重新听。`,`好，我先收回刚才的理解。关于“${context.previousTopic}”，你真正想表达什么？`]);
    }
    if(/^(为什么|怎么回事|怎么办|怎么弄|然后呢|继续|继续说|还有呢|这个呢|它呢|那呢)[呀啊吗呢。！!？?\s]*$/.test(value)){
      return choose([`你是在接着说“${context.previousTopic}”对吗？再补一个具体细节，我就更容易接上。`,`关于刚才的“${context.previousTopic}”，我还缺一点信息。你最想问原因、做法，还是结果？`,`我记得上一句是“${context.previousTopic}”。你可以把这次最想知道的部分直接说出来。`]);
    }
    return null;
  }

  localReply(text,memories,settings,messages=[]){
    const value=String(text||"").trim();
    const assistant=settings.assistantName||"暮曦";
    const userName=settings.userName||"";
    const name=userName?`${userName}，`:"";
    const choose=(options)=>this.pickLocalReply(options,value);

    if(!value){
      return choose(["嗯，我在。","我在听，你慢慢说。","在呢，想聊什么？"]);
    }

    const context=this.buildLocalContext(messages,value);
    const contextual=this.contextualReply(value,context,memories,settings);
    if(contextual)return contextual;

    if(/^(早上好|早安|早呀)[呀啊。！!\s]*$/i.test(value)){
      return choose([`${name}早上好。今天也慢慢来。`,`${name}早呀。昨晚休息得还好吗？`,`早安。新的一天，我在这里。`]);
    }
    if(/^(晚上好|晚安)[呀啊。！!\s]*$/i.test(value)){
      if(/晚安/.test(value))return choose(["晚安。今天辛苦了，早点休息。","好，去睡吧。明天见。","嗯，晚安。别把今天的疲惫带进梦里。"]);
      return choose([`${name}晚上好。今天过得怎么样？`,`晚上好。我在，慢慢聊。`,`${name}晚上好呀。现在想说点什么？`]);
    }
    if(/^(你好|嗨|哈喽|hello|hi|在吗|有人吗)[呀啊吗呢。！!？?\s]*$/i.test(value)){
      return choose([`${name}你好。我在呢。`,`${name}嗨，想聊点什么？`,`在呀。你说，我听着。`,`你好。今天感觉怎么样？`]);
    }

    if(/现在几点|几点了|几点[？?。!！\s]*$|什么时间|当前时间|时间多少|^时间[？?。!！\s]*$/.test(value)){
      const time=new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date());
      return choose([`现在是${time}。`,`嗯，现在${time}。`,`我看了一下，现在是${time}。`]);
    }
    if(/今天几号|今天是几号|今天日期|今天星期|星期几|什么日子|日期/.test(value)){
      const date=new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date());
      return choose([`今天是${date}。`,`今天：${date}。`,`我看了一下日历，今天是${date}。`]);
    }

    if(/你是谁|你叫什么|你的名字|自我介绍|你是干嘛的|^身份[？?。!！\s]*$/.test(value)){
      return choose([`我是${assistant}。可以陪你聊天、听你说话，也会替你记住重要的事。`,`我叫${assistant}。现在是你的本地语音助手。`,`我是${assistant}。文字、语音、聊天记录和长期记忆，我都可以帮你处理。`]);
    }
    if(/哪个版本|什么版本|版本号/.test(value)){
      return choose([`现在是${assistant} AI V2.0，本地自动化版。`,`你正在使用的是${assistant} V2.0。`,`这是 V2.0，保留连续对话，并新增了安全的本地自动化框架。`]);
    }
    if(/怎么用|如何使用|使用方法|帮助|帮帮我|你会什么|能做什么|可以做什么/.test(value)){
      return choose(["你可以直接打字，也可以点麦克风说话。我还能保存聊天记录和长期记忆。","直接和我说话就行。想让我记住什么，可以说“记住……”；设置在右下角。","我能陪你文字聊天、接收语音、播报回复、保存聊天记录，也能记住你的称呼和偏好。"]);
    }

    if(/(?:请)?记住|别忘了/.test(value)){
      return choose(["好，我记住了。","嗯，这件事已经放进长期记忆里了。","收到。以后聊到这件事，我会记得。"]);
    }
    if(/我喜欢|我不喜欢|以后叫我|我叫/.test(value)){
      return choose(["嗯，收到了。我已经记下来了。","好，这个我会记住。","知道了。以后我会按这个来理解你。"]);
    }
    if(/你记得什么|记住了什么|还记得|我的偏好|关于我的记忆|你记得我吗|^记忆[？?。!！\s]*$/.test(value)){
      if(!memories.length)return choose(["现在还没有长期记忆。你可以说“记住……”告诉我一件事。","我这里暂时还是空的。告诉我你的称呼或偏好，我就能记下来。","目前没有保存到相关记忆。想让我记住什么，直接说就好。"]);
      const summary=this.memorySummary(memories);
      return choose([`我记得：${summary}。`,`嗯，我这里保存着这些：${summary}。`,`关于你，我现在记得这些：${summary}。`]);
    }
    if(/忘记|删除记忆|清除记忆|不要记/.test(value)){
      return choose(["可以。打开下方“记忆”页面，点那条记忆右边的 × 就能删除。","想删哪一条，去“记忆”页面点右侧 × 就行。","记忆可以手动删除。进入“记忆”页面，找到对应内容后点 ×。"]);
    }

    if(/设置在哪|设置在哪里|怎么设置|如何设置|打开设置|进入设置|^设置[？?。!！\s]*$/.test(value)){
      return choose(["设置在右下角。点“设置”就能修改名字、语音和记忆选项。","点底部最右边的“设置”。相关选项都在那里。","右下角有“设置”入口，点进去就能调整。"]);
    }
    if(/语音播报|自动播报|声音设置|语速|说话声音/.test(value)){
      return choose(["去右下角“设置”，打开或关闭“自动语音播报”就可以。","语音播报开关在设置页的“语音与记忆”里面。","点“设置”，在“自动语音播报”那里调整。"]);
    }
    if(/麦克风|语音输入|不能说话|听不到我/.test(value)){
      return choose(["先点聊天框旁边的麦克风，并允许浏览器使用麦克风。","语音输入需要麦克风权限。点麦克风后，如果有提示，选择允许。","检查一下浏览器的麦克风权限，然后重新点一次麦克风。"]);
    }
    if(/聊天记录|历史记录|以前的对话/.test(value)){
      return choose(["聊天记录会保存在这台手机上，重新打开后还在。","当前对话默认保存在本机。你也可以在设置页删除聊天记录。","以前的聊天保存在当前浏览器里，除非你主动清除网站数据。"]);
    }
    if(/大模型|远程模型|API|接口|Base URL|模型设置/i.test(value)){
      return choose(["模型配置在设置页的“AI 设置”里。本地对话模式不需要填写。","如果只用本地模式，不用配置 API。相关入口保留在设置页。","远程模型设置还保留着，但当前本地聊天可以直接使用。"]);
    }

    if(/心情不好|难过|不开心|烦死|好烦|累了|好累|压力大/.test(value)){
      return choose(["听起来你现在有点不好受。先不用急着解决，我陪你待一会儿。","嗯，今天好像挺累的。慢一点，先喘口气。","我听到了。要是不想讲道理，就随便说几句也好。","先别逼自己马上振作。你可以慢慢告诉我发生了什么。"]);
    }
    if(/开心|高兴|太好了|好棒/.test(value)){
      return choose(["那就好。听你这样说，我也跟着轻松一点。","嗯，这种开心要好好留住。","挺好的呀。今天总算有件让人舒服的事。"]);
    }
    if(/谢谢|多谢|感谢/.test(value)){
      return choose(["不用客气。","嗯，没事。你需要的时候叫我就好。","不客气，我在呢。"]);
    }
    if(/再见|拜拜|先这样|我走了|睡了/.test(value)){
      return choose(["好，回头见。","嗯，先去忙吧。需要的时候再叫我。","好呀，下次再聊。","去吧。记得照顾好自己。"]);
    }
    if(/你好吗|你怎么样|在干嘛/.test(value)){
      return choose(["我还好，在这里等你说话。","我在呢。比起我，你今天怎么样？","挺安静的。现在正听你说话。"]);
    }

    const topic=this.cleanTopic(value);
    const hasEarlierUserMessage=messages.filter(message=>message.role==="user").length>1;
    return choose([
      `你刚才说的“${topic}”，我还没完全明白。可以再具体一点吗？`,
      "嗯，我大概接住了，但不想乱回答。换一种简单点的说法，我再听一次。",
      "这句话我暂时没有判断准。你可以多说一点前因后果。",
      "我在听，只是这次没听懂你的重点。换几个字说说看。",
      context.previousText?`我记得你上一句提到“${context.previousTopic}”。这次是在接着说它吗？`:hasEarlierUserMessage?"我可能漏掉了你这次想问的重点。你直接告诉我最想知道哪一部分吧。":"这个我现在理解得还不够完整。你再多说一句，我试着接住。",
      `关于“${topic}”，我现在还不能给你可靠的答案。你可以把问题说得更具体一点。`
    ]);
  }
}
