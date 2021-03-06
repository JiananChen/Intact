import {inherit, extend, result, each, isFunction, isEqual, uniqueId, get} from './utils';
import Thunk from './thunk';
import Vdt from 'vdt';

let Intact = function(attrs = {}, contextWidgets = {}) {
    if (!(this instanceof Intact)) {
        return new Thunk(this, attrs, contextWidgets);
    }

    if (!this.template) {
        throw new Error('Can not instantiate when this.template does not exist.');
    }

    attrs = extend({
        children: undefined 
    }, result(this, 'defaults'), attrs);

    this._events = {};
    this.attributes = {};

    this.vdt = Vdt(this.template);
    this.set(attrs, {silent: true});
    this.key = attrs.key;

    this.widgets = this.vdt.widgets || {};

    this.inited = false;
    this.rendered = false;
    this._hasCalledInit = false;

    this._contextWidgets = contextWidgets;
    this._widget = this.attributes.widget || uniqueId('widget');

    // for debug
    this.displayName = this.displayName;

    this.addEvents(); 

    this.children = this.get('children');
    delete this.attributes.children;
    // 存在widget名称引用属性，则注入所处上下文的widgets中
    this._contextWidgets[this._widget] = this;

    // 如果存在arguments属性，则将其拆开赋给attributes
    if (this.attributes.arguments) {
        extend(this.attributes, result(this.attributes, 'arguments'));
        delete this.attributes.arguments;
    }

    // change事件，自动更新，当一个更新操作正在进行中，下一个更新操作必须等其完成
    this._updateCount = 0;
    let handleUpdate = () => {
        if (this._updateCount > 0) {
            this.update();
            this._updateCount--;
            handleUpdate.call(this);
        }
    };

    let ret = this._init();
    // support promise
    let inited = () => {
        this.inited = true;
        this.trigger('inited', this);
        // don't bind change event to update until component inited
        this.on('change', function() { 
            if (++this._updateCount === 1) {
                handleUpdate();
            } else if (this._updateCount > 10) {
                throw new Error('Too many recursive update.');
            }
        });
    };
    if (ret && ret.then) {
        ret.then(inited);
    } else {
        inited();
    }
};

Intact.prototype = {
    constructor: Intact,

    type: 'Widget',

    _init() {},

    _create() {},

    _beforeUpdate(prevWidget, domNode) {},

    _update(prevWidget, domNode) {},

    _destroy(domNode) {},

    removeEvents() {
        // 解绑所有事件
        each(this.attributes, (value, key) => {
            if (key.substring(0, 3) === 'ev-' && isFunction(value)) {
                this.off(key.substring(3), value);
                delete this.attributes[key];
            }
        });
    },

    addEvents(attrs) {
        // 所有以'ev-'开头的属性，都转化为事件
        attrs || (attrs = this.attributes);
        each(attrs, (value, key) => {
            if (key.substring(0, 3) === 'ev-' && isFunction(value)) {
                this.on(key.substring(3), value);
            }
        });
    },

    init(isUpdate/* for private */) {
        // support async component
        if (!this.inited && !isUpdate) {
            var placeholder = document.createComment('placeholder');
            this.on('inited', function() {
                var parent = placeholder.parentNode;
                parent && parent.replaceChild(this.init(), placeholder);
            });
            return placeholder;
        }

        !isUpdate && (this.element = this.vdt.render(this));
        this.rendered = true;
        this._hasCalledInit = true;
        this.trigger('rendered', this);
        this._create();
        return this.element;
    },

    update(prevWidget, domNode) {
        if (!this.vdt.node && (!prevWidget || !prevWidget.vdt.node)) return;
        this._beforeUpdate(prevWidget, domNode);
        if (prevWidget && domNode) {
            this.vdt.node = domNode;
            this.vdt.tree = prevWidget.vdt.tree;
        }
        this.prevWidget = prevWidget;
        this.element = this.vdt.update(this);
        if (!this._hasCalledInit) {
            this.init(true);
        }
        this._update(prevWidget, domNode);
        return this.element;
    },

    destroy(domNode) {
        // 如果只是移动了一个组件，会先执行创建，再销毁，所以需要判断父组件引用的是不是自己
        if (this._contextWidgets[this._widget] === this) {
            delete this._contextWidgets[this._widget];
        }
        this.off();
        function destroy(children) {
            each(children, function(child) {
                if (child.hasThunks) {
                    destroy(child.children);
                } else if (child.type === 'Thunk') {
                    child.widget.destroy();
                }
            });
        }
        destroy([this.vdt.tree]);
        this._destroy(domNode);
    },

    get(attr, defaultValue) {
        if (!arguments.length) return this.attributes;
        
        let ret;
        if (attr === 'children') {
            // @deprecated for v0.0.1 compatibility, use this.children instead of
            ret = this.attributes.children || this.children;
        } else {
            // support get value by path like lodash `_.get`
            ret = get(this.attributes, attr);
        }

        return ret === undefined ? defaultValue : ret;
    },

    set(key, val, options) {
        if (key == null) return this;

        let attrs;

        if (typeof key === 'string') {
            pathFilter.call(this, key, val);
        }
        else if (typeof key === 'object') {
            for (var item in key) {
                pathFilter.call(this, item, key[item]);
            }
            attrs = key;
            options = val;
        }

        function pathFilter(path, value) {
            path = castPath(path);
            var index = -1,
                length = path.length,
                lastIndex = length - 1,
                obj, obj2 = obj =this.attributes;

            while (obj != null && ++index < length) {
                var key = path[index];
                if (index == lastIndex) {
                    obj[key] = value;
                } else {
                    var temp = path[index + 1];
                    _.has(obj2, obj[key]);
                    obj[key] = /^\d+$/.test(temp) ? [] : {};
                }
                obj = obj[key];
            }
            return obj;
        }

        options = extend({
            silent: false,
            global: true,
            async: false
        }, options);

        let current = this.attributes,
            changes = [];

        for (let attr in attrs) {
            val = attrs[attr];
            if (!isEqual(current[attr], val)) {
                changes.push(attr);
            }
            current[attr] = val;
        }

        if (changes.length) {
            let eventName;
            for (let i = 0, l = changes.length; i < l; i++) {
                let attr = changes[i];
                eventName = `change:${attr}`;
                options[eventName] && options[eventName].call(this, current[attr]);
                !options.silent && this.trigger(eventName, this, current[attr]);
            }

            options.change && options.change.call(this);
            if (!options.silent) {
                this.trigger('beforeChange', this);
                if (options.global) {
                    clearTimeout(this._asyncUpdate);
                    let triggerChange = () => {
                        this.trigger('change', this);
                        for (let i = 0, l = changes.length; i < l; i++) {
                            let attr = changes[i],
                                eventName = `changed:${attr}`;

                            options[eventName] && options[eventName].call(this, current[attr]);
                            this.trigger(eventName, this, current[attr]);
                        }
                    };
                    if (options.async) {
                        this._asyncUpdate = setTimeout(triggerChange);
                    } else {
                        triggerChange();
                    }
                }
            }
        }

        return this;
    },

    on(name, callback) {
        (this._events[name] || (this._events[name] = [])).push(callback);

        return this;
    },

    off(name, callback) {
        if (!arguments.length) {
            this._events = {};
            return this;
        }

        let callbacks = this._events[name];
        if (!callbacks) return this;

        if (arguments.length === 1) {
            delete this._events[name];
            return this;
        }

        for (let cb, i = 0; i < callbacks.length; i++) {
            cb = callbacks[i];
            if (cb === callback) {
                callbacks.splice(i, 1);
                i--;
            }
        }

        return this;
    },

    trigger(name, ...args) {
        let callbacks = this._events[name];

        if (callbacks) {
            for (let i = 0, l = callbacks.length; i < l; i++) {
                callbacks[i].apply(this, args);
            }
        }

        return this;
    }
};

/**
 * @brief 继承某个组件
 *
 * @param prototype
 */
Intact.extend = function(prototype = {}) {
    prototype.defaults = extend({}, this.prototype.defaults, prototype.defaults);
    return inherit(this, prototype);
};

/**
 * 挂载组件到dom中
 * @param widget {Intact} Intact类或子类，也可以是实例化的对象
 * @param node {Node} html节点
 */
Intact.mount = function(widget, node) {
    if (widget.prototype && (widget.prototype instanceof Intact || widget === Intact)) {
        widget = new widget();
    }
    if (widget.rendered) {
        node.appendChild(widget.element);
    } else if (widget.inited) {
        node.appendChild(widget.init()); 
    } else {
        widget.on('inited', () => node.appendChild(widget.init()));
    }
    return widget;
};

export default Intact;
