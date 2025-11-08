(function(){
  'use strict';

  // ===== Supabase (BYT DESSA) =====
  var SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co; // byt
  var SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';                    // byt
  var SUPABASE_BUCKET = 'audio';
  var SUPABASE_PATH   = 'reviews';

  // ===== refs =====
  var startBtn = document.getElementById('startBtn');
  var stopBtn  = document.getElementById('stopBtn');
  var maxSel   = document.getElementById('maxlen');
  var stateEl  = document.getElementById('state');
  var codecEl  = document.getElementById('codec');
  var mimeEl   = document.getElementById('mime');
  var fnameEl  = document.getElementById('fname');
  var fsizeEl  = document.getElementById('fsize');
  var durEl    = document.getElementById('dur');
  var statusEl = document.getElementById('status');
  var player   = document.getElementById('player');
  var dl       = document.getElementById('dl');
  var share    = document.getElementById('share');
  var copyBtn  = document.getElementById('copy');
  var dot      = document.getElementById('dot');
  var uaEl     = document.getElementById('ua');
  uaEl.textContent = navigator.userAgent;

  // ===== state =====
  var STATE = { IDLE:'idle', REC:'recording', STOP:'stopping', DONE:'done' };
  var startedAt=0, tick=null, hard=null, MAX_MS=+maxSel.value;

  function log(m){ statusEl.textContent = (statusEl.textContent ? statusEl.textContent+'\n' : '') + m; }
  function setState(s){
    stateEl.textContent = s;
    dot.textContent = 'status: ' + s;
    startBtn.disabled = (s!==STATE.IDLE);
    stopBtn.disabled  = (s!==STATE.REC);
  }
  setState(STATE.IDLE);
  maxSel.onchange = function(){ MAX_MS = +maxSel.value; };

  function tstr(ms){ var s=(ms/1000|0), m=('0'+(s/60|0)).slice(-2); return m+':'+('0'+(s%60)).slice(-2); }
  function startTick(){
    startedAt=performance.now();
    stopTick();
    tick=setInterval(function(){
      var e=performance.now()-startedAt;
      durEl.textContent=tstr(e);
      if(e>=MAX_MS){ log('Auto-stop'); stopRec(); }
    }, 250);
  }
  function stopTick(){ if(tick){ clearInterval(tick); tick=null; } }

  // ===== WAV engine (44.1 kHz mono) =====
  var stream=null, ac=null, src=null, proc=null;
  var bufs=[], chs=1, rate=44100;

  async function startRec(){
    try{
      setState(STATE.REC);
      statusEl.textContent = '1) Begar mikrofon...';
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      log('Mikrofon OK');
      startTick();

      var AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC({ sampleRate: 44100 });
      log('2) AudioContext ' + ac.sampleRate + ' Hz');
      rate = ac.sampleRate;
      src = ac.createMediaStreamSource(stream);
      chs = 1;
      proc = ac.createScriptProcessor(4096, chs, chs);
      bufs=[]; for(var c=0;c<chs;c++) bufs[c]=[];
      proc.onaudioprocess = function(e){
        for(var c=0;c<chs;c++) bufs[c].push(new Float32Array(e.inputBuffer.getChannelData(c)));
      };
      src.connect(proc); proc.connect(ac.destination);
      log('3) Spelar in ...');

      codecEl.textContent='WAV-fallback';
      mimeEl.textContent='audio/wav';
      fnameEl.textContent='-'; fsizeEl.textContent='-';
      dl.style.display='none'; player.src=''; share.style.display='none'; copyBtn.style.display='none';

      if(hard) clearTimeout(hard);
      hard = setTimeout(function(){ log('Auto-stop (hard)'); stopRec(); }, MAX_MS+600);
    }catch(e){
      setState(STATE.IDLE); stopTick();
      log('Fel: '+e.message);
    }
  }

  function stopRec(){
    if(stateEl.textContent!==STATE.REC && stateEl.textContent!==STATE.STOP) return;
    setState(STATE.STOP); stopTick(); if(hard){ clearTimeout(hard); hard=null; }
    log('4) Stoppar inspelning...');
    try{ proc&&proc.disconnect(); src&&src.disconnect(); }catch(_){}

    try{
      log('5) Bygger WAV...');
      var len=0; for(var i=0;i<bufs[0].length;i++) len+=bufs[0][i].length;
      var inter=new Float32Array(len*chs), off=0;
      for(var b=0;b<bufs[0].length;b++){
        var L=bufs[0][b].length;
        for(var s=0;s<L;s++){
          for(var c=0;c<chs;c++){
            inter[(off+s)*chs+c]=bufs[c][b][s];
          }
        }
        off+=L;
      }
      var bytesPerSample=2, blockAlign=chs*bytesPerSample;
      var ab=new ArrayBuffer(44 + inter.length*bytesPerSample), view=new DataView(ab);
      function W(v,o,str){ for(var i=0;i<str.length;i++) v.setUint8(o+i, str.charCodeAt(i)); }
      W(view,0,'RIFF'); view.setUint32(4,36+inter.length*bytesPerSample,true);
      W(view,8,'WAVE'); W(view,12,'fmt ');
      view.setUint32(16,16,true); view.setUint16(20,1,true);
      view.setUint16(22,chs,true); view.setUint32(24,rate,true);
      view.setUint32(28,rate*blockAlign,true); view.setUint16(32,blockAlign,true);
      view.setUint16(34,16,true); W(view,36,'data');
      view.setUint32(40,inter.length*bytesPerSample,true);
      var idx=44;
      for(var k=0;k<inter.length;k++){
        var s=Math.max(-1,Math.min(1,inter[k]));
        view.setInt16(idx, s<0?s*0x8000:s*0x7FFF, true);
        idx+=2;
      }
      var blob=new Blob([view],{type:'audio/wav'});
      log('WAV klar: ' + (blob.size/1024/1024).toFixed(2) + ' MB');
      finish(blob,'wav');
    }catch(err){
      log('Packningsfel: '+err.message);
    }

    try{ ac&&ac.close(); }catch(_){}
    try{ stream&&stream.getTracks().forEach(function(t){ t.stop(); }); }catch(_){}
  }

  async function finish(blob,ext){
    setState(STATE.DONE);
    var url = URL.createObjectURL(blob);
    player.src = url; try{ player.load(); }catch(_){}
    var name = 'kenai-'+ts()+'.'+ext;
    dl.download = name; dl.href = url; dl.style.display='inline-block';
    fnameEl.textContent = name; fsizeEl.textContent = (blob.size/1024/1024).toFixed(2)+' MB';

    var publicUrl = await uploadSupabase(blob, name);
    if(publicUrl){
      share.href = publicUrl; share.style.display='inline-block';
      copyBtn.style.display='inline-block';
      copyBtn.onclick = async function(){
        try{ await navigator.clipboard.writeText(publicUrl); log('Lank kopierad'); }
        catch(e){ log('Kunde inte kopiera: ' + e.message); }
      };
    }
    log('Klar - tryck Play om den inte startar sjalv.');
  }

  async function uploadSupabase(blob, name){
    try{
      if(!SUPABASE_URL.startsWith('https') || SUPABASE_ANON.length < 20){
        log('Supabase ej konfigurerad - hoppar over upload.');
        return null;
      }
      var endpoint = SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/' +
        encodeURIComponent(SUPABASE_BUCKET) + '/' + SUPABASE_PATH + '/' + encodeURIComponent(name);
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization':'Bearer '+SUPABASE_ANON, 'Content-Type':'audio/wav', 'x-upsert':'true' },
        body: blob
      });
      if(!res.ok){
        var txt=await res.text();
        throw new Error('Upload misslyckades: '+res.status+' '+txt);
      }
      log('Uppladdning klar till Supabase');
      return SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/' +
             SUPABASE_BUCKET + '/' + SUPABASE_PATH + '/' + name;
    }catch(err){
      log('Supabase-fel: '+err.message);
      return null;
    }
  }

  function ts(){
    var d=new Date(),p=function(n){return ('0'+n).slice(-2)};
    return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
  }

  startBtn.addEventListener('click', startRec);
  stopBtn .addEventListener('click', stopRec);

  window.addEventListener('error', function(e){
    setState(STATE.IDLE); log('JS-fel: '+e.message);
    startBtn.disabled=false; stopBtn.disabled=true;
  });
})();
