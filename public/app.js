// app.js — minimal sanity test
(function(){
  'use strict';
  console.log('app.js loaded');
  var startBtn = document.getElementById('startBtn');
  var stopBtn  = document.getElementById('stopBtn');
  var statusEl = document.getElementById('status');
  startBtn.addEventListener('click', function(){ alert('JS OK'); statusEl.textContent='JS OK'; });
  stopBtn .addEventListener('click', function(){ alert('STOP');  statusEl.textContent='STOP';  });
})();
