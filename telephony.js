const {execFile}=require("child_process");
const path=require("path");

function run(args){
	return new Promise((resolve,reject)=>{
		execFile("asterisk",["-rx",args.join(" ")],(e,out,err)=>{
			if(e)return reject(new Error(err||out||e.message));
			resolve(out.trim());
		});
	});
}

async function call(number,audio){
	if(!number)throw new Error("Missing destination number");
	if(!process.env.OUTBOUND_TRUNK)throw new Error("OUTBOUND_TRUNK is not configured");
	const caller=process.env.OUTBOUND_DID||process.env.OUTBOUND_EXT;
	if(!caller)throw new Error("OUTBOUND_DID or OUTBOUND_EXT is not configured");
	const file=path.resolve(audio).replace(/\\/g,"/");
	const target=`PJSIP/${number}@${process.env.OUTBOUND_TRUNK}`;
	const cmd=`channel originate ${target} application Playback ${file.replace(/^.*\\/,"")}`;
	console.log(`[LOCAL-DIAL] ${caller} -> ${number}`);
	return run(cmd.split(" "));
}

module.exports={call};
