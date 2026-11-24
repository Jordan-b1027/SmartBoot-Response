const dgram=require("dgram"),fs=require("fs"),os=require("os");
const ip=()=>Object.values(os.networkInterfaces()).flat().find(x=>x.family==="IPv4"&&!x.internal)?.address||"127.0.0.1";
const hex=()=>Math.random().toString(16).slice(2);
const ulaw=s=>{let o=Buffer.alloc(s.length/2),p=0;for(let i=0;i<s.length;i+=2){let x=s.readInt16LE(i),n=x<0?128:0;if(x<0)x=-x;x=Math.min(x,32635);let e=7;for(let v=x>>7;v;v>>=1)e--;let m=e?(x>>(e+3))&15:(x>>4)&15;o[p++]=~(n|(e<<4)|m)&255}return o};
const wav=f=>{let b=fs.readFileSync(f.endsWith(".wav")?f:f+".wav"),r=b.readUInt32LE(24),c=b.readUInt16LE(22),q=b.readUInt16LE(34),i=12;while(i<b.length&&b.toString("ascii",i,i+4)!=="data")i+=8+b.readUInt32LE(i+4);if(r!==8000||c!==1||q!==16)throw Error("Audio must be 8kHz mono PCM16");return ulaw(b.subarray(i+8))};
const hdr=s=>{let h={};s.split(/\r\n/).forEach(x=>{let i=x.indexOf(":");if(i>0)h[x.slice(0,i).toLowerCase()]=x.slice(i+1).trim()});return h};
const sdp=s=>{let m=s.match(/m=audio (\d+) RTP\/AVP ([0-9 ]+)/),c=s.match(/c=IN IP4 ([^\r\n]+)/);return m&&c?{port:+m[1],host:c[1],pt:m[2].split(" ").map(Number)}:null};
const packet=(req,body="")=>req+"\r\nContent-Length: "+Buffer.byteLength(body)+"\r\n\r\n"+body;
async function call(number,audio){
 for(const k of ["OUTBOUND_CALLERID","USERNAME","SIP_SERVER","SIP_SERVER_PORT"])if(!process.env[k])throw Error(k+" is not configured");
 const host=ip(),sip=dgram.createSocket("udp4"),rtp=dgram.createSocket("udp4");
 await new Promise(r=>sip.bind(0,host,r));await new Promise(r=>rtp.bind(0,host,r));
 const sp=sip.address().port,rp=rtp.address().port,server=process.env.SIP_SERVER,port=+process.env.SIP_SERVER_PORT;
 const id=hex()+hex(),tag=hex(),uri="sip:"+number+"@"+server,from="sip:"+process.env.OUTBOUND_CALLERID+"@"+server;
 const s="v=0\r\no=smartboot 1 1 IN IP4 "+host+"\r\ns=SmartBoot Response\r\nc=IN IP4 "+host+"\r\nt=0 0\r\nm=audio "+rp+" RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\na=sendrecv\r\n";
 const cseq=1,via="SIP/2.0/UDP "+host+":"+sp+";branch=z9hG4bK"+hex()+";rport";
 const req=packet("INVITE "+uri+" SIP/2.0\r\nVia: "+via+"\r\nMax-Forwards: 70\r\nFrom: <"+from+">;tag="+tag+"\r\nTo: <"+uri+">\r\nCall-ID: "+id+"\r\nCSeq: "+cseq+" INVITE\r\nContact: <sip:"+(process.env.AUTHUSERNAME||process.env.USERNAME)+"@"+host+":"+sp+">\r\nContent-Type: application/sdp",s);
 const send=x=>new Promise((r,j)=>sip.send(Buffer.from(x),port,server,e=>e?j(e):r()));
 await send(req);
 const a=await new Promise((resolve,reject)=>{let tm=setTimeout(()=>reject(Error("SIP call timeout")),30000);sip.on("message",m=>{let x=m.toString(),code=+(x.match(/^SIP\/2.0 (\d+)/)||[])[1];if(code===401||code===407)return reject(Error("SIP authentication required"));if(code===200){clearTimeout(tm);resolve({h:hdr(x),s:sdp(x)})}})});
 if(!a.s)throw Error("SIP response has no audio SDP");
 const to=a.h.to,ack=packet("ACK "+uri+" SIP/2.0\r\nVia: "+via+"\r\nMax-Forwards: 70\r\nFrom: <"+from+">;tag="+tag+"\r\nTo: "+to+"\r\nCall-ID: "+id+"\r\nCSeq: "+cseq+" ACK\r\nContact: <sip:"+(process.env.AUTHUSERNAME||process.env.USERNAME)+"@"+host+":"+sp+">");
 await send(ack);
 const data=wav(audio),pt=a.s.pt.includes(0)?0:a.s.pt.includes(8)?8:null;if(pt===null)throw Error("Provider does not accept PCMU or PCMA");
 let seq=Math.random()*65535|0,ts=Math.random()*0xffffffff>>>0,ssrc=Math.random()*0xffffffff>>>0;
 for(let i=0;i<data.length;i+=160){let p=data.subarray(i,i+160);if(pt===8)p=Buffer.from(p.map(x=>~x&255));let r=Buffer.alloc(12+p.length);r[0]=128;r[1]=pt|(i+160>=data.length?128:0);r.writeUInt16BE(seq++&65535,2);r.writeUInt32BE(ts>>>0,4);r.writeUInt32BE(ssrc>>>0,8);p.copy(r,12);await new Promise(z=>rtp.send(r,a.s.port,a.s.host,z));ts+=160;await new Promise(z=>setTimeout(z,20))}
 await new Promise(r=>setTimeout(r,1000));
 await send(packet("BYE "+uri+" SIP/2.0\r\nVia: "+via+"\r\nMax-Forwards: 70\r\nFrom: <"+from+">;tag="+tag+"\r\nTo: "+to+"\r\nCall-ID: "+id+"\r\nCSeq: 2 BYE\r\nContact: <sip:"+(process.env.AUTHUSERNAME||process.env.USERNAME)+"@"+host+":"+sp+">"));
 sip.close();rtp.close();console.log("[SIP] "+process.env.OUTBOUND_CALLERID+" -> "+number);
}
module.exports={call};
