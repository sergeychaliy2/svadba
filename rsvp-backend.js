/* ============================================================================
   Отправка анкет гостей в Google-таблицу.

   Этот файл — единственное место, где живёт «серверная» логика сайта.
   Он специально вынесен отдельно от дизайна: если вы заново выгрузите
   макет из Claude Design, достаточно будет вернуть в index.html две строки
   (см. README.md, раздел «Если вы переделали дизайн»).
   ============================================================================ */

window.WeddingRSVP = (function () {
  'use strict';

  var STORE_KEY = 'wedding_rsvp_sent';

  /* ---------------------------------------------------------------------
     JSONP-запрос. Google Apps Script не отдаёт CORS-заголовки при обычном
     fetch, поэтому данные уходят через <script> — работает во всех
     браузерах, включая старые версии Safari на iPhone.
     --------------------------------------------------------------------- */
  function jsonp(url, params) {
    return new Promise(function (resolve, reject) {
      var cb = 'wcb' + Date.now() + Math.floor(Math.random() * 10000);
      var script = document.createElement('script');
      var finished = false;

      var timer = setTimeout(function () {
        cleanup();
        reject(new Error('сервер не ответил'));
      }, 25000);

      function cleanup() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cb] = function (data) { cleanup(); resolve(data); };
      script.onerror = function () { cleanup(); reject(new Error('нет связи')); };

      var query = ['callback=' + cb];
      Object.keys(params).forEach(function (k) {
        query.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      });

      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + query.join('&');
      document.head.appendChild(script);
    });
  }

  return {

    /* Вызывается из формы в index.html после того, как она сама
       проверила, что все поля заполнены.
         component — компонент анкеты (нужен, чтобы менять его состояние)
         guests    — [{ name, main, salad }, ...]
         opts      — { attending: true|false, comment: '…' }             */
    submit: function (component, guests, opts) {

      opts = opts || {};
      var attending = opts.attending !== false;
      var url = (window.WEDDING_CONFIG || {}).API_URL;

      if (!url) {
        component.setState({
          error: 'Форма ещё не подключена к таблице ответов. См. README.md, шаг 2.'
        });
        return;
      }

      var payload = {
        attending: attending,
        comment: String(opts.comment || '').trim(),
        guests: guests.map(function (g) {
          return {
            name:  String(g.name || '').trim().replace(/\s+/g, ' '),
            main:  attending ? g.main  : '',
            salad: attending ? g.salad : ''
          };
        })
      };

      component.setState({ sending: true, error: '' });

      jsonp(url, { action: 'rsvp', payload: JSON.stringify(payload) })
        .then(function (res) {
          if (!res || !res.ok) {
            throw new Error((res && res.error) || 'ответ не сохранился');
          }
          try {
            localStorage.setItem(STORE_KEY, JSON.stringify({
              at: Date.now(),
              names: payload.guests.map(function (g) { return g.name; })
            }));
          } catch (e) { /* режим инкогнито — не страшно */ }

          component.setState({ sending: false, submitted: true });
        })
        .catch(function (err) {
          component.setState({
            sending: false,
            error: 'Не удалось отправить: ' + err.message +
                   '. Проверьте интернет и нажмите «Отправить» ещё раз.'
          });
        });
    },

    /* Что уже отправляли с этого устройства (или null) */
    lastSent: function () {
      try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); }
      catch (e) { return null; }
    }
  };
}());
