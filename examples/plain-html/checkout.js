import '/pay-qr.js';
const component=document.querySelector('pay-qr');
const timer=document.querySelector('#payment-timer');
const timeLeft=document.querySelector('#time-left');
const result=document.querySelector('#result');
let interval;
component.addEventListener('pay:created',({detail:{payment}})=>{
  clearInterval(interval);
  result.textContent='';timer.hidden=false;
  // Count down to the server deadline, including time spent loading the QR.
  const update=()=>{
    const seconds=Math.max(0,Math.ceil((payment.expiresAt-Date.now())/1000));
    timeLeft.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    if(seconds===0)clearInterval(interval);
  };
  update();interval=setInterval(update,250);
});
for(const [event,message] of Object.entries({'pay:success':'ชำระเงินสำเร็จ','pay:expired':'QR หมดอายุแล้ว','pay:cancelled':'ยกเลิกการชำระเงินแล้ว','pay:error':'ไม่สามารถดำเนินการชำระเงินได้'})){
  component.addEventListener(event,()=>{
    clearInterval(interval);
    if(event==='pay:expired')timeLeft.textContent='00:00';else timer.hidden=true;
    result.textContent=message;
  });
}
window.addEventListener('pagehide',()=>clearInterval(interval));
