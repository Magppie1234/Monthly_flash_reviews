'use strict';
const path=require('node:path');
require('../lib/mis-pipeline').runPipeline(path.resolve(__dirname,'..'),{onProgress:(module,p)=>{if(p.pages===1||p.pages%25===0)console.log(`${module}: ${p.records} records, ${p.pages} pages`);}}).then(status=>console.log(JSON.stringify(status,null,2))).catch(error=>{console.error('MIS pipeline: '+error.message);process.exitCode=1;});
