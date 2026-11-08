/* Explicit microphone capture, averaged into mono PCM16 at 16 kHz. */
class LiveCapture extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.sum=0;this.weight=0;this.ratio=sampleRate/16000;}
 process(inputs){const channel=inputs[0]?.[0];if(!channel)return true;
  for(const value of channel){let left=1;while(left>0){const use=Math.min(left,this.ratio-this.weight);this.sum+=value*use;this.weight+=use;left-=use;if(this.weight>=this.ratio-1e-8){this.samples.push(Math.max(-1,Math.min(1,this.sum/this.ratio)));this.sum=0;this.weight=0;}}}
  while(this.samples.length>=640){const values=this.samples.splice(0,640),pcm=new ArrayBuffer(1280),view=new DataView(pcm);values.forEach((v,i)=>view.setInt16(i*2,v<0?v*32768:v*32767,true));this.port.postMessage(pcm,[pcm]);}
  return true;
 }
}
registerProcessor('live-capture',LiveCapture);
