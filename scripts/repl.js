(function(babel, $, _, ace, window) {

  /* Throw meaningful errors for getters of commonjs. */
  ["module", "exports", "require"].forEach(function(commonVar){
    Object.defineProperty(window, commonVar, { 
      get: function () { 
        throw new Error(commonVar + " is not supported in the browser, you need a commonjs environment such as node.js/io.js, browserify/webpack etc");
      }
    });
  });
  
  /*
   * Utils for working with the browser's URI (e.g. the query params)
   */
  function UriUtils () {}

  UriUtils.encode = function (value) {
    return window.encodeURIComponent(value);
  };

  UriUtils.decode = function (value) {
    try {
      return window.decodeURIComponent('' + value);
    } catch (err) {
      return value;
    }
  };

  UriUtils.parseQuery = function () {
    var query = window.location.hash.replace(/^\#\?/, '');

    if (!query) {
      return null;
    }

    return query.split('&').map(function(param) {
      var splitPoint = param.indexOf('=');

      return {
        key : param.substring(0, splitPoint),
        value : param.substring(splitPoint + 1)
      };
    }).reduce(function(params, param){
      if (param.key && param.value) {
        params[param.key] = UriUtils.decode(param.value);
      }
      return params;
    }, {});
  };

  UriUtils.updateQuery = function (object) {
    var query = Object.keys(object).map(function(key){
      return key + '=' + UriUtils.encode(object[key]);
    }).join('&');

    window.location.hash = '?' + query;
  };

  /*
   * Long term storage for persistence of state/etc
   */
  function StorageService () {
    this.store = window.localStorage;
  }

  StorageService.prototype.get = function (key) {
    try {
      return JSON.parse(this.store.getItem(key));
    } catch(e) {}
  };

  StorageService.prototype.set = function (key, value) {
    try {
      this.store.setItem(key, JSON.stringify(value));
    } catch(e) {}
  };

  /*
   * Decorating the ACE editor
   */
  function Editor(selector) {
    this.$el = $(selector);
    this.editor = ace.edit(this.$el[0]);
    this.session = this.editor.getSession();
    this.document = this.session.getDocument();

    this.editor.setTheme('ace/theme/tomorrow');
    this.editor.setShowPrintMargin(false);
    this.$el.css({
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      lineHeight: 'inherit'
    });

    this.session.setMode('ace/mode/javascript');
    this.session.setUseSoftTabs(true);
    this.session.setTabSize(2);
    this.session.setUseWorker(false);

    this.editor.setOption('scrollPastEnd', 0.33);
  }

  /*
   * Options exposed for the REPL that will influence Babel's transpiling
   */
  function $checkbox($element){
    return {
      get: function () {
        return $element.is(":checked");
      } ,
      set: function (value) {
        var setting = value !== 'false' && value !== false;
        $element.prop('checked', setting);
      },
      enumerable: true,
      configurable: false
    };
  }

  /*
   * Babel options for transpilation as used by the REPL
   */
  function Options () {
    var $experimental = $('#option-experimental');
    var $playground = $('#option-playground');
    var $evaluate = $('#option-evaluate');
    var $loose = $('#option-loose-mode');
    var $spec = $('#option-spec');

    var options = {};
    Object.defineProperties(options, {
      'experimental': $checkbox($experimental),
      'playground': $checkbox($playground),
      'evaluate': $checkbox($evaluate),
      'loose': $checkbox($loose),
      'spec': $checkbox($spec)
    });

    // Merge in defaults
    var defaults = {
      experimental : true,
      playground : false,
      loose : false,
      spec : false,
      evaluate : true
    };

    _.assign(options, defaults);

    return options;
  }

  /*
   * Babel Web REPL
   */
  function REPL () {
    this.storage = new StorageService();
    var state = this.storage.get('replState') || {};
    _.assign(state, UriUtils.parseQuery());

    this.options = _.assign(new Options(), state);

    this.input = new Editor('.babel-repl-input .ace_editor').editor;
    this.input.setValue(UriUtils.decode(state.code || ''));

    this.output = new Editor('.babel-repl-output .ace_editor').editor;
    this.output.setReadOnly(true);
    this.output.setHighlightActiveLine(false);
    this.output.setHighlightGutterLine(false);

    this.$errorReporter = $('.babel-repl-errors');
    this.$consoleReporter = $('.babel-repl-console');
    this.$toolBar = $('.babel-repl-toolbar');
  }

  REPL.prototype.clearOutput = function () {
    this.$errorReporter.text('');
    this.$consoleReporter.text('');
  };

  REPL.prototype.setOutput = function (output) {
    this.output.setValue(output, -1);
  };

  REPL.prototype.printError = function (message) {
    this.$errorReporter.text(message);
  };

  REPL.prototype.getSource = function () {
    return this.input.getValue();
  };

  REPL.prototype.compile = function () {

    var transformed;
    var code = this.getSource();
    this.clearOutput();

    try {
      transformed = babel.transform(code, {
        experimental: this.options.experimental,
        playground: this.options.playground,
        loose: this.options.loose && "all",
        optional: this.options.spec && ["spec.typeofSymbol", "es6.blockScopingTDZ"],
        filename: 'repl'
      });
    } catch (err) {
      this.printError(err.message);
      throw err;
    }

    this.setOutput(transformed.code);

    if (this.options.evaluate) {
      this.evaluate(transformed.code);
    }
  };

  REPL.prototype.evaluate = function(code) {
    var capturingConsole = Object.create(console);
    var $consoleReporter = this.$consoleReporter;
    var buffer = [];
    var error;
    var done = false;

    function flush() {
      $consoleReporter.text(buffer.join('\n'));
    }

    function write(data) {
      buffer.push(data);
      if (done) flush();
    }

    capturingConsole.log = function() {
      if (this !== capturingConsole) { return; }

      var args = Array.prototype.slice.call(arguments);
      Function.prototype.apply.call(console.log, console, args);

      var logs = args.reduce(function (logs, log) {
        logs.push(inspect(log));
        return logs;
      }, []);

      write(logs.join(' '));
    };

    try {
      new Function('console', code)(capturingConsole);
    } catch (err) {
      error = err;
      buffer.push(err.message);
    }

    done = true;
    flush();

    if (error) throw error;
  };

  REPL.prototype.persistState = function (state) {
    UriUtils.updateQuery(state);
    this.storage.set('replState', state);
  };

  /*
   * Initialize the REPL
   */
  var repl = new REPL();

  function onSourceChange () {
    var error;
    try {
      repl.compile();
    } catch(err) {
      error = err;
    }
    var code = repl.getSource();
    var state = _.assign(repl.options, {
      code: code
    });
    repl.persistState(state);
    if (error) throw error;
  }

  repl.input.on('change', _.debounce(onSourceChange, 500));
  repl.$toolBar.on('change', onSourceChange);

  repl.compile();

  // taken from io.js/node

  function inspect(obj) {
    var ctx = { seen: [] };
    return formatValue(ctx, obj, 3);
  }

  function arrayToHash(array) {
    var hash = {};

    array.forEach(function(val, idx) {
      hash[val] = true;
    });

    return hash;
  }

  function formatValue(ctx, value, recurseTimes) {
    // Primitive types cannot have properties
    var primitive = formatPrimitive(ctx, value);
    if (primitive) {
      return primitive;
    }

    // Look up the keys of the object.
    var keys = Object.keys(value);
    var visibleKeys = arrayToHash(keys);

    // This could be a boxed primitive (new String(), etc.), check valueOf()
    // NOTE: Avoid calling `valueOf` on `Date` instance because it will return
    // a number which, when object has some additional user-stored `keys`,
    // will be printed out.
    var formatted;
    var raw = value;
    try {
      // the .valueOf() call can fail for a multitude of reasons
      if (!isDate(value))
        raw = value.valueOf();
    } catch (e) {
      // ignore...
    }

    if (typeof raw === 'string') {
      // for boxed Strings, we have to remove the 0-n indexed entries,
      // since they just noisey up the output and are redundant
      keys = keys.filter(function(key) {
        return !(key >= 0 && key < raw.length);
      });
    }

    // Some type of object without properties can be shortcutted.
    if (keys.length === 0) {
      if (typeof value === 'function') {
        var name = value.name ? ': ' + value.name : '';
        return '[Function' + name + ']';
      }
      if (isRegExp(value)) {
        return RegExp.prototype.toString.call(value);
      }
      if (isDate(value)) {
        return Date.prototype.toString.call(value);
      }
      if (isError(value)) {
        return formatError(value);
      }
      // now check the `raw` value to handle boxed primitives
      if (typeof raw === 'string') {
        formatted = formatPritive(ctx, raw);
        return '[String: ' + formatted + ']';
      }
      if (typeof raw === 'number') {
        formatted = formatPritive(ctx, raw);
        return '[Number: ' + formatted + ']';
      }
      if (typeof raw === 'boolean') {
        formatted = formatPritive(ctx, raw);
        return '[Boolean: ' + formatted + ']';
      }
    }

    var base = '', array = false, braces = ['{', '}'];

    // Make Array say that they are Array
    if (Array.isArray(value)) {
      array = true;
      braces = ['[', ']'];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      var n = value.name ? ': ' + value.name : '';
      base = ' [Function' + n + ']';
    }

    // Make RegExps say that they are RegExps
    if (isRegExp(value)) {
      base = ' ' + RegExp.prototype.toString.call(value);
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + Date.prototype.toUTCString.call(value);
    }

    // Make error with message first say the error
    if (isError(value)) {
      base = ' ' + formatError(value);
    }

    // Make boxed primitive Strings look like such
    if (typeof raw === 'string') {
      formatted = formatPrimitive(ctx, raw);
      base = ' ' + '[String: ' + formatted + ']';
    }

    // Make boxed primitive Numbers look like such
    if (typeof raw === 'number') {
      formatted = formatPrimitive(ctx, raw);
      base = ' ' + '[Number: ' + formatted + ']';
    }

    // Make boxed primitive Booleans look like such
    if (typeof raw === 'boolean') {
      formatted = formatPrimitive(ctx, raw);
      base = ' ' + '[Boolean: ' + formatted + ']';
    }

    if (keys.length === 0 && (!array || value.length === 0)) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return RegExp.prototype.toString.call(value);
      } else {
        return '[Object]';
      }
    }

    ctx.seen.push(value);

    var output;
    if (array) {
      output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
    } else {
      output = keys.map(function(key) {
        return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
      });
    }

    ctx.seen.pop();

    return reduceToSingleString(output, base, braces);
  }


  function formatPrimitive(ctx, value) {
    if (value === undefined)
      return 'undefined';

    // For some reason typeof null is "object", so special case here.
    if (value === null)
      return 'null';

    var type = typeof value;

    if (type === 'string') {
      var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
          .replace(/'/g, "\\'")
          .replace(/\\"/g, '"') + '\'';
      return simple;
    }
    if (type === 'number') {
      // Format -0 as '-0'. Strict equality won't distinguish 0 from -0,
      // so instead we use the fact that 1 / -0 < 0 whereas 1 / 0 > 0 .
      if (value === 0 && 1 / value < 0)
        return '-0';
      return '' + value;
    }
    if (type === 'boolean')
      return '' + value;
    // es6 symbol primitive
    if (type === 'symbol')
      return value.toString();
  }

  function formatError(value) {
    return '[' + Error.prototype.toString.call(value) + ']';
  }


  function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
    var output = [];
    for (var i = 0, l = value.length; i < l; ++i) {
      if (hasOwnProperty(value, String(i))) {
        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
            String(i), true));
      } else {
        output.push('');
      }
    }
    keys.forEach(function(key) {
      if (typeof key === 'symbol' || !key.match(/^\d+$/)) {
        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
            key, true));
      }
    });
    return output;
  }


  function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
    var name, str, desc;
    desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
    if (desc.get) {
      if (desc.set) {
        str = '[Getter/Setter]';
      } else {
        str = '[Getter]';
      }
    } else {
      if (desc.set) {
        str = '[Setter]';
      }
    }
    if (!hasOwnProperty(visibleKeys, key)) {
      if (typeof key === 'symbol') {
        name = '[' + key.toString() + ']';
      } else {
        name = '[' + key + ']';
      }
    }
    if (!str) {
      if (ctx.seen.indexOf(desc.value) < 0) {
        if (recurseTimes === null) {
          str = formatValue(ctx, desc.value, null);
        } else {
          str = formatValue(ctx, desc.value, recurseTimes - 1);
        }
        if (str.indexOf('\n') > -1) {
          if (array) {
            str = str.split('\n').map(function(line) {
              return '  ' + line;
            }).join('\n').substr(2);
          } else {
            str = '\n' + str.split('\n').map(function(line) {
              return '   ' + line;
            }).join('\n');
          }
        }
      } else {
        str = '[Circular]';
      }
    }
    if (name === undefined) {
      if (array && key.match(/^\d+$/)) {
        return str;
      }
      name = JSON.stringify('' + key);
      if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
        name = name.substr(1, name.length - 2);
      } else {
        name = name.replace(/'/g, "\\'")
                   .replace(/\\"/g, '"')
                   .replace(/(^"|"$)/g, "'")
                   .replace(/\\\\/g, '\\');
      }
    }

    return name + ': ' + str;
  }


  function reduceToSingleString(output, base, braces) {
    var length = output.reduce(function(prev, cur) {
      return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
    }, 0);

    if (length > 60) {
      return braces[0] +
             (base === '' ? '' : base + '\n ') +
             ' ' +
             output.join(',\n  ') +
             ' ' +
             braces[1];
    }

    return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
  }

  function isRegExp(re) {
    return re !== null && typeof re === 'object' &&
           objectToString(re) === '[object RegExp]';
  }

  function isDate(d) {
    return d !== null && typeof d === 'object' &&
           objectToString(d) === '[object Date]';
  }

  function isError(e) {
    return e !== null && typeof e === 'object' &&
        (objectToString(e) === '[object Error]' || e instanceof Error);
  }

  function objectToString(o) {
    return Object.prototype.toString.call(o);
  }

}(babel, $, _, ace, window));
