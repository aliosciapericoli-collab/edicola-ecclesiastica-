// fetch-content.js — fetch testo completo articolo per Scalata
'use strict';
var https = require('https');
var http = require('http');

function fetchArticleText(url, maxChars) {
  maxChars = maxChars || 50000;
  return new Promise(function(resolve) {
    if (!url || url.includes('news.google.com')) { resolve(''); return; }
    try {
      var proto = url.startsWith('https') ? https : http;
      var req = proto.get(url, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity',
          'Accept-Language': 'it-IT,it;q=0.9'
        }
      }, function(res) {
        if (res.statusCode >= 301 && res.statusCode <= 303 && res.headers.location) {
          fetchArticleText(res.headers.location, maxChars).then(resolve);
          return;
        }
        if (res.statusCode !== 200) { resolve(''); return; }
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(c) {
          data += c;
          if (data.length > 120000) res.destroy();
        });
        res.on('end', function() {
          var text = data
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
          .replace(/<header[\s\S]*?<\/header>/gi, ' ')
          .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#8217;/g,"'").replace(/&#8230;/g,'...')
          .replace(/\s+/g, ' ').trim();
          resolve(text.substring(0, maxChars));
        });
        res.on('error', function() { resolve(''); });
      });
      req.on('error', function() { resolve(''); });
      req.on('timeout', function() { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

module.exports = { fetchArticleText };
