(function (Global, undefined) {

    "use strict";

    /**
     * The kit's main entry point; initialize your API like this: Prismic.Api(url, callback, accessToken, maybeRequestHandler)
     *
     * @global
     * @alias Api
     * @constructor
     * @param {string} url - The mandatory URL of the prismic.io API endpoint (like: https://lesbonneschoses.prismic.io/api)
     * @param {function} callback - Optional callback function that is called after the API was retrieved, to which you may pass three parameters: a potential error (null if no problem), the API object, and the XMLHttpRequest
     * @param {string} accessToken - The optional accessToken for the OAuth2 connection
     * @param {function} maybeRequestHandler - The kit knows how to handle the HTTP request in Node.js and in the browser (with Ajax); you will need to pass a maybeRequestHandler if you're in another JS environment
     * @returns {Api} - The Api object that can be manipulated
     */
    var prismic = function(url, callback, accessToken, maybeRequestHandler, maybeApiCache) {
        var api = new prismic.fn.init(url, accessToken, maybeRequestHandler, maybeApiCache);
        callback && api.get(callback);
        return api;
    };
    // note that the prismic variable is later affected as "Api" while exporting

    // -- Request handlers

    var ajaxRequest = (function() {
        if(typeof XMLHttpRequest != 'undefined' && 'withCredentials' in new XMLHttpRequest()) {
            return function(url, callback) {

                var xhr = new XMLHttpRequest();

                // Called on success
                var resolve = function() {
                    callback(null, JSON.parse(xhr.responseText), xhr);
                };

                // Called on error
                var reject = function() {
                    var status = xhr.status;
                    callback(new Error("Unexpected status code [" + status + "] on URL "+url), null, xhr);
                };

                // Bind the XHR finished callback
                xhr.onreadystatechange = function() {
                    if (xhr.readyState === 4) {
                        if(xhr.status && xhr.status == 200) {
                            resolve();
                        } else {
                            reject();
                        }
                    }
                };

                // Open the XHR
                xhr.open('GET', url, true);

                // Json request
                xhr.setRequestHeader('Accept', 'application/json');

                // Send the XHR
                xhr.send();
            };
        }
    });

    var xdomainRequest = (function() {
        if(typeof XDomainRequest != 'undefined') {
            return function(url, callback) {

                var xdr = new XDomainRequest();

                // Called on success
                var resolve = function() {
                    callback(null, JSON.parse(xdr.responseText), xdr);
                };

                // Called on error
                var reject = function(msg) {
                    callback(new Error(msg), null, xdr);
                };

                // Bind the XDR finished callback
                xdr.onload = function() {
                    resolve(xdr);
                };

                // Bind the XDR error callback
                xdr.onerror = function() {
                    reject("Unexpected status code on URL "+url);
                };

                // Open the XHR
                xdr.open('GET', url, true);

                // Bind the XDR timeout callback
                xdr.ontimeout = function () {
                    reject("Request timeout");
                };

                // Empty callback. IE sometimes abort the reqeust if
                // this is not present
                xdr.onprogress = function () { };

                xdr.send();
            };
        }
    });

    var nodeJSRequest = (function() {
        if(typeof require == 'function' && require('http')) {
            var requestsCache = {},
                http = require('http'),
                https = require('https'),
                url = require('url'),
                querystring = require('querystring');

            return function(requestUrl, callback) {
                if(requestsCache[requestUrl]) {
                    callback(null, requestsCache[requestUrl]);
                } else {

                    var parsed = url.parse(requestUrl),
                        h = parsed.protocol == 'https:' ? https : http,
                        options = {
                            hostname: parsed.hostname,
                            path: parsed.path,
                            query: parsed.query,
                            headers: { 'Accept': 'application/json' }
                        };

                    h.get(options, function(response) {
                        if(response.statusCode && response.statusCode == 200) {
                            var jsonStr = '';

                            response.setEncoding('utf8');
                            response.on('data', function (chunk) {
                                jsonStr += chunk;
                            });

                            response.on('end', function () {
                              var cacheControl = response.headers['cache-control'],
                                  maxAge = cacheControl && /max-age=(\d+)/.test(cacheControl) ? parseInt(/max-age=(\d+)/.exec(cacheControl)[1]) : undefined,
                                  json = JSON.parse(jsonStr);

                              if(maxAge) {
                                  requestsCache[requestUrl] = json;
                              }

                              callback(null, json, response);
                            });
                        } else {
                            callback(new Error("Unexpected status code [" + response.statusCode + "] on URL "+requestUrl), null, response);
                        }
                    });

                }

            };
        }
    });

    // Defining Api's instance methods; note that the prismic variable is later affected as "Api" while exporting
    prismic.fn = prismic.prototype = {

        constructor: prismic,
        data: null,

        /**
         * Requests (with the proper handler), parses, and returns the /api document.
         * This is for internal use, from outside this kit, you should call Prismic.Api()
         *
         * @param {function} callback - Optional callback function that is called after the query is made, to which you may pass three parameters: a potential error (null if no problem), the API object, and the XMLHttpRequest
         * @returns {Api} - The Api object that can be manipulated
         */
        get: function(callback) {
            var self = this;
            var cacheKey = this.url + (this.accessToken ? ('#' + this.accessToken) : '');
            this.apiCache.getOrSet(
                cacheKey,
                5, // ttl
                function fetchApi (cb) {
                    self.requestHandler(self.url, function(error, data, xhr) {
                        if (error) {
                            cb && cb(error, null, xhr);
                        } else {
                            cb && cb(null, self.parse(data), xhr);
                        }
                    });
                },
                function done (error, api, xhr) {
                    if(error) {
                        callback && callback(error, null, xhr);
                    } else {
                        self.data = api;
                        self.bookmarks = api.bookmarks;
                        callback && callback(null, self, xhr);
                    }
                }
            );
        },

        /**
         * Parses and returns the /api document.
         * This is for internal use, from outside this kit, you should call Prismic.Api()
         *
         * @param {string} data - The JSON document responded on the API's endpoint
         * @returns {Api} - The Api object that can be manipulated
         * @private
         */
        parse: function(data) {
            var refs,
                master,
                forms = {},
                form,
                types,
                tags,
                f,
                i;

            // Parse the forms
            for (i in data.forms) {
                if (data.forms.hasOwnProperty(i)) {
                    f = data.forms[i];

                    if(this.accessToken) {
                        f.fields['accessToken'] = {};
                        f.fields['accessToken']['type'] = 'string';
                        f.fields['accessToken']['default'] = this.accessToken;
                    }

                    form = new Form(
                        f.name,
                        f.fields,
                        f.form_method,
                        f.rel,
                        f.enctype,
                        f.action
                    );

                    forms[i] = form;
                }
            }

            refs = data.refs.map(function (r) {
                return new Ref(
                    r.ref,
                    r.label,
                    r.isMasterRef,
                    r.scheduledAt,
                    r.id
                );
            }) || [];

            master = refs.filter(function (r) {
                return r.isMaster === true;
            });

            types = data.types;

            tags = data.tags;

            if (master.length === 0) {
                throw ("No master ref.");
            }

            return {
                bookmarks: data.bookmarks || {},
                refs: refs,
                forms: forms,
                master: master[0],
                types: types,
                tags: tags,
                oauthInitiate: data['oauth_initiate'],
                oauthToken: data['oauth_token']
            };

        },

        /**
         * Initialisation of the API object.
         * This is for internal use, from outside this kit, you should call Prismic.Api()
         * @private
         */
        init: function(url, accessToken, maybeRequestHandler, maybeApiCache) {
            this.url = url + (accessToken ? (url.indexOf('?') > -1 ? '&' : '?') + 'access_token=' + accessToken : '');
            this.accessToken = accessToken;
            this.requestHandler = maybeRequestHandler || ajaxRequest() || xdomainRequest() || nodeJSRequest() || (function() {throw new Error("No request handler available (tried XMLHttpRequest & NodeJS)");})();
            this.apiCache = maybeApiCache || new ApiCache();
            return this;
        },

        /**
         * @deprecated use form() now
         * @param {string} formId - The id of a form, like "everything", or "products"
         * @returns {SearchForm} - the SearchForm that can be used.
         */
        forms: function(formId) {
            return this.form(formId);
        },

        /**
         * Returns a useable form from its id, as described in the RESTful description of the API.
         * For instance: api.form("everything") works on every repository (as "everything" exists by default)
         * You can then chain the calls: api.form("everything").query('[[:d = at(document.id, "UkL0gMuvzYUANCpf")]]').ref(ref).submit()
         *
         * @param {string} formId - The id of a form, like "everything", or "products"
         * @returns {SearchForm} - the SearchForm that can be used.
         */
        form: function(formId) {
            var form = this.data.forms[formId];
            if(form) {
                return new SearchForm(this, form, {});
            }
        },

        /**
         * The ID of the master ref on this prismic.io API.
         * Do not use like this: searchForm.ref(api.master()).
         * Instead, set your ref once in a variable, and call it when you need it; this will allow to change the ref you're viewing easily for your entire page.
         *
         * @returns {string}
         */
        master: function() {
            return this.data.master.ref;
        },

        /**
         * Returns the ref ID for a given ref's label.
         * Do not use like this: searchForm.ref(api.ref("Future release label")).
         * Instead, set your ref once in a variable, and call it when you need it; this will allow to change the ref you're viewing easily for your entire page.
         *
         * @param {string} label - the ref's label
         * @returns {string}
         */
        ref: function(label) {
            for(var i=0; i<this.data.refs.length; i++) {
                if(this.data.refs[i].label == label) {
                    return this.data.refs[i].ref;
                }
            }
        }

    };

    prismic.fn.init.prototype = prismic.fn;

    /**
     * Embodies a submittable RESTful form as described on the API endpoint (as per RESTful standards)
     * @constructor
     * @private
     */
    function Form(name, fields, form_method, rel, enctype, action) {
        this.name = name;
        this.fields = fields;
        this.form_method = form_method;
        this.rel = rel;
        this.enctype = enctype;
        this.action = action;
    }

    Form.prototype = {};

    /**
     * Embodies a SearchForm object. To create SearchForm objects that are allowed in the API, please use the API.form() method.
     * @constructor
     * @global
     * @alias SearchForm
     */
    function SearchForm(api, form, data) {
        this.api = api;
        this.form = form;
        this.data = data || {};

        for(var field in form.fields) {
            if(form.fields[field]['default']) {
                this.data[field] = [form.fields[field]['default']];
            }
        }
    };

    SearchForm.prototype = {

        /**
         * Set an API call parameter. This will only work if field is a valid field of the
         * RESTful form in the first place (as described in the /api document); otherwise,
         * an "Unknown field" error is thrown.
         * Please prefer using dedicated methods like query(), orderings(), ...
         *
         * @param {string} field - The name of the field to set
         * @param {string} value - The value that gets assigned
         * @returns {SearchForm} - The SearchForm itself
         */
        set: function(field, value) {
            var fieldDesc = this.form.fields[field];
            if(!fieldDesc) throw new Error("Unknown field " + field);
            var values= this.data[field] || [];
            if(value === '' || value === undefined) {
                // we must compare value to null because we want to allow 0
                value = null;
            }
            if(fieldDesc.multiple) {
                value != null && values.push(value);
            } else {
                values = value != null && [value];
            }
            this.data[field] = values;
            return this;
        },

        /**
         * Sets a ref to query on for this SearchForm. This is a mandatory
         * method to call before calling submit(), and api.form('everything').submit()
         * will not work.
         *
         * @param {Ref} ref - The Ref object defining the ref to query
         * @returns {SearchForm} - The SearchForm itself
         */
        ref: function(ref) {
            return this.set("ref", ref);
        },

        /**
         * Sets a predicate-based query for this SearchForm. This is where you
         * paste what you compose in your prismic.io API browser.
         * You can pass an empty string, the method will simply not send that query.
         *
         * @param {string} query - The query to perform
         * @returns {SearchForm} - The SearchForm itself
         */
        query: function(query) {
            return this.set("q", query);
        },

        /**
         * Sets a page size to query for this SearchForm. This is an optional method.
         *
         * @param {number} pageSize - The page size
         * @returns {SearchForm} - The SearchForm itself
         */
        pageSize: function(size) {
            return this.set("pageSize", size);
        },

        /**
         * Sets the page number to query for this SearchForm. This is an optional method.
         *
         * @param {number} page - The page number
         * @returns {SearchForm} - The SearchForm itself
         */
        page: function(p) {
            return this.set("page", p);
        },

        /**
         * Sets the orderings to query for this SearchForm. This is an optional method.
         *
         * @param {string} orderings - The orderings
         * @returns {SearchForm} - The SearchForm itself
         */
        orderings: function(orderings) {
            return this.set("orderings", orderings);
        },

        /**
         * Submits the query, and calls the callback function.
         *
         * @param {function} callback - Optional callback function that is called after the query was made,
         * to which you may pass three parameters: a potential error (null if no problem),
         * a Response object (containing all the pagination specifics + the array of Docs),
         * and the XMLHttpRequest
         */
        submit: function(callback) {
            var self = this,
                url = this.form.action;

            if(this.data) {
                var sep = (url.indexOf('?') > -1 ? '&' : '?');
                for(var key in this.data) {
                    var values = this.data[key];
                    if(values) {
                        for(var i=0; i<values.length; i++) {
                            url += sep + key + '=' + encodeURIComponent(values[i]);
                            sep = '&';
                        }
                    }
                }
            }

            this.api.requestHandler(url, function (err, documents, xhr) {

                if (err) { callback(err, null, xhr); return; }

                var results = documents.results.map(function (doc) {

                    var linkedDocuments = [];
                    if(doc.linked_documents) {
                        linkedDocuments = doc.linked_documents.map(function(linkedDoc) {
                            return new LinkedDocument(linkedDoc['id'], linkedDoc['slug'], linkedDoc['type'], linkedDoc['tags']);
                        });
                    }

                    var fragments = {};
                    for(var field in doc.data[doc.type]) {
                        fragments[doc.type + '.' + field] = doc.data[doc.type][field];
                    }

                    /* Removing incorrect spans from StructuredText fragments */
                    // This should be removed when the issue is fixed in the API
                    for(var fragmentKey in fragments) {
                        var fragment = fragments[fragmentKey];
                        if (fragment.type === 'StructuredText') {
                            for (var blockKey in fragment.value) {
                                var block = fragment.value[blockKey];
                                var newSpanArray = [];
                                for (var spanKey in block.spans) {
                                    var span = block.spans[spanKey];
                                    if (span.start < span.end) {
                                        newSpanArray.push(span);
                                    }
                                }
                                block['spans'] = newSpanArray;
                            }
                        }
                    }

                    return new Doc(
                        doc.id,
                        doc.type,
                        doc.href,
                        doc.tags,
                        doc.slugs,
                        linkedDocuments,
                        fragments
                    );
                });

                callback(null, new Response(
                    documents.page,
                    documents.results_per_page,
                    documents.results_size,
                    documents.total_results_size,
                    documents.total_pages,
                    documents.next_page,
                    documents.prev_page,
                    results || []), xhr
                );
            });

        }

    };

    /**
     * An array of the fragments with the given fragment name.
     * The array is often a single-element array, expect when the fragment is a multiple fragment.
     * @private
     */
    function getFragments(name) {
        if (!this.fragments || !this.fragments[name]) {
            return [];
        }

        if (Array.isArray(this.fragments[name])) {
            return this.fragments[name];
        } else {
            return [this.fragments[name]];
        }

    };

    /**
     * Embodies the response of a SearchForm query as returned by the API.
     * It includes all the fields that are useful for pagination (page, total_pages, total_results_size, ...),
     * as well as the field "results", which is an array of Doc objects, the documents themselves.
     * @constructor
     * @global
     */
    function Response(page, results_per_page, results_size, total_results_size, total_pages, next_page, prev_page, results) {
        /**
         * @field
         * @description the current page number
         */
        this.page = page;
        /**
         * @field
         * @description the number of results per page
         */
        this.results_per_page = results_per_page;
        /**
         * @field
         * @description the size of the current page
         */
        this.results_size = results_size;
        /**
         * @field
         * @description the total size of results across all pages
         */
        this.total_results_size = total_results_size;
        /**
         * @field
         * @description the total number of pages
         */
        this.total_pages = total_pages;
        /**
         * @field
         * @description the URL of the next page in the API
         */
        this.next_page = next_page;
        /**
         * @field
         * @description the URL of the previous page in the API
         */
        this.prev_page = prev_page;
        /**
         * @field
         * @description the array of the {Doc} objects
         */
        this.results = results;
    }

    function LinkedDocument(id, slug, type, tags) {
        this.id = id;
        this.slug = slug;
        this.type = type;
        this.tags = tags;
    }

    /**
     * Embodies a document as returned by the API.
     * Most useful fields: id, type, tags, slug, slugs, ...
     * @constructor
     * @global
     * @alias Doc
     */
    function Doc(id, type, href, tags, slugs, linkedDocuments, fragments) {

        /**
         * @field
         * @description the ID of the document
         */
        this.id = id;
        /**
         * @field
         * @description the type of the document
         */
        this.type = type;
        /**
         * @field
         * @description the URL of the document in the API
         */
        this.href = href;
        /**
         * @field
         * @description the tags of the document
         */
        this.tags = tags;
        /**
         * @field
         * @description the current slug of the document
         */
        this.slug = slugs ? slugs[0] : "-";
        /**
         * @field
         * @description all the slugs that were ever used by this document (including the current one, at the head)
         */
        this.slugs = slugs;
        this.linkedDocuments = linkedDocuments;
        this.fragments = fragments;
    }

    Doc.prototype = {
        /**
         * Gets the fragment in the current Document object. Since you most likely know the type
         * of this fragment, it is advised that you use a dedicated method, like get StructuredText() or getDate(),
         * for instance.
         *
         * @param {string} name - The name of the fragment to get, with its type; for instance, "blog-post.author"
         * @returns {object} - The JavaScript Fragment object to manipulate
         */
        get: function(name) {
            var frags = getFragments.call(this, name);
            return frags.length ? Global.Prismic.Fragments.initField(frags[0]) : null;
        },

        /**
         * Builds an array of all the fragments in case they are multiple.
         *
         * @param {string} name - The name of the multiple fragment to get, with its type; for instance, "blog-post.author"
         * @returns {array} - An array of each JavaScript fragment object to manipulate.
         */
        getAll: function(name) {
            return getFragments.call(this, name).map(function (fragment) {
                return Global.Prismic.Fragments.initField(fragment);
            }, this);
        },

        /**
         * Gets the image fragment in the current Document object, for further manipulation.
         * Typical use: document.getImage('blog-post.photo').asHtml(ctx)
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.photo"
         * @returns {ImageEl} - The Image object to manipulate
         */
        getImage: function(fragment) {
            var img = this.get(fragment);
            if (img instanceof Global.Prismic.Fragments.Image) {
                return img;
            }
            if (img instanceof Global.Prismic.Fragments.StructuredText) {
                // find first image in st.
                return img;
            }
            return null;
        },

        // Useful for obsolete multiples
        getAllImages: function(fragment) {
            var images = this.getAll(fragment);

            return images.map(function (image) {
                if (image instanceof Global.Prismic.Fragments.Image) {
                    return image;
                }
                if (image instanceof Global.Prismic.Fragments.StructuredText) {
                    throw new Error("Not done.");
                }
                return null;
            });
        },


        /**
         * Gets the view within the image fragment in the current Document object, for further manipulation.
         * Typical use: document.getImageView('blog-post.photo', 'large').asHtml(ctx)
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.photo"
         * @returns {ImageView} - The View object to manipulate
         */
        getImageView: function(fragment, view) {
            var fragment = this.get(fragment);
            if (fragment instanceof Global.Prismic.Fragments.Image) {
                return fragment.getView(view);
            }
            if (fragment instanceof Global.Prismic.Fragments.StructuredText) {
                for(var i=0; i<fragment.blocks.length; i++) {
                    if(fragment.blocks[i].type == 'image') {
                        return fragment.blocks[i];
                    }
                }
            }
            return null;
        },

        // Useful for obsolete multiples
        getAllImageViews: function(fragment, view) {
            return this.getAllImages(fragment).map(function (image) {
                return image.getView(view);
            });
        },

        /**
         * Gets the date fragment in the current Document object, for further manipulation.
         * Typical use: document.getDate('blog-post.publicationdate').asHtml(ctx)
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.publicationdate"
         * @returns {Date} - The Date object to manipulate
         */
        getDate: function(fragment) {
            var fragment = this.get(fragment);

            if(fragment instanceof Global.Prismic.Fragments.Date) {
                return fragment.value;
            }
        },

        /**
         * Gets a boolean value of the fragment in the current Document object, for further manipulation.
         * Typical use: if(document.getBoolean('blog-post.enableComments')) { ... }
         * This works great with a Select fragment. The Select values that are considered true are (lowercased before matching): 'yes', 'on', and 'true'.
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.enableComments"
         * @returns {boolean} - The boolean value of the fragment
         */
        getBoolean: function(fragment) {
            var fragment = this.get(fragment);
            return fragment.value && (fragment.value.toLowerCase() == 'yes' || fragment.value.toLowerCase() == 'on' || fragment.value.toLowerCase() == 'true');
        },

        /**
         * Gets the text fragment in the current Document object, for further manipulation.
         * Typical use: document.getText('blog-post.label').asHtml(ctx).
         * The method works with StructuredText fragments, Text fragments, Number fragments, Select fragments and Color fragments.
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.label"
         * @param {string} after - a suffix that will be appended to the value
         * @returns {object} - either StructuredText, or Text, or Number, or Select, or Color.
         */
        getText: function(fragmentName, after) {
            var fragment = this.get(fragmentName);

            if (fragment instanceof Global.Prismic.Fragments.StructuredText) {
                return fragment.blocks.map(function(block) {
                    if(block.text) {
                        return block.text + (after ? after : '');
                    }
                }).join('\n');
            }

            if (fragment instanceof Global.Prismic.Fragments.Text) {
                if(fragment.value) {
                    return fragment.value + (after ? after : '');
                }
            }

            if (fragment instanceof Global.Prismic.Fragments.Number) {
                if(fragment.value) {
                    return fragment.value + (after ? after : '');
                }
            }

            if (fragment instanceof Global.Prismic.Fragments.Select) {
                if(fragment.value) {
                    return fragment.value + (after ? after : '');
                }
            }

            if (fragment instanceof Global.Prismic.Fragments.Color) {
                if(fragment.value) {
                    return fragment.value + (after ? after : '');
                }
            }
        },

        /**
         * Gets the StructuredText fragment in the current Document object, for further manipulation.
         * Typical use: document.getStructuredText('blog-post.body').asHtml(ctx).
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.body"
         * @returns {StructuredText} - The StructuredText fragment to manipulate.
         */
        getStructuredText: function(fragment) {
            var fragment = this.get(fragment);

            if (fragment instanceof Global.Prismic.Fragments.StructuredText) {
                return fragment;
            }
        },

        /**
         * Gets the Number fragment in the current Document object, for further manipulation.
         * Typical use: document.getNumber('product.price')
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "product.price"
         * @returns {number} - The number value of the fragment.
         */
        getNumber: function(fragment) {
            var fragment = this.get(fragment);

            if (fragment instanceof Global.Prismic.Fragments.Number) {
                return fragment.value;
            }
        },

        /**
         * Gets the Color fragment in the current Document object, for further manipulation.
         * Typical use: document.getColor('product.color')
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "product.color"
         * @returns {string} - The string value of the Color fragment.
         */
        getColor: function(fragment) {
            var fragment = this.get(fragment);

            if (fragment instanceof Global.Prismic.Fragments.Color) {
                return fragment.value;
            }
        },

        /* Gets the GeoPoint fragment in the current Document object, for further manipulation.
         * Typical use: document.getGeoPoint('blog-post.location').asHtml(ctx)
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.location"
         * @returns {GeoPoint} - The GeoPoint object to manipulate
         */
        getGeoPoint: function(fragment) {
            var fragment = this.get(fragment);

            if(fragment instanceof Global.Prismic.Fragments.GeoPoint) {
                return fragment;
            }
        },

        /**
         * Gets the Group fragment in the current Document object, for further manipulation.
         * Typical use: document.getGroup('product.gallery').asHtml(ctx).
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "product.gallery"
         * @returns {Group} - The Group fragment to manipulate.
         */
        getGroup: function(fragment) {
            var fragment = this.get(fragment);

            if (fragment instanceof Global.Prismic.Fragments.Group) {
                return fragment;
            }
        },

        /**
         * Shortcut to get the HTML output of the fragment in the current document.
         * This is the same as writing document.get(fragment).asHtml(ctx);
         *
         * @param {string} fragment - The name of the fragment to get, with its type; for instance, "blog-post.body"
         * @param {function} ctx - The ctx object that contains the context: ctx.api, ctx.ref, ctx.maybeRef, ctx.oauth(), and ctx.linkResolver()
         * @returns {string} - The HTML output
         */
        getHtml: function(fragment, ctx) {
            var fragment = this.get(fragment);

            if(fragment && fragment.asHtml) {
                return fragment.asHtml(ctx);
            }
        },

        /**
         * Transforms the whole document as an HTML output. Each fragment is separated by a <section> tag,
         * with the attribute data-field="nameoffragment"
         *
         * @param {object} ctx - The ctx object that contains the context: ctx.api, ctx.ref, ctx.maybeRef, ctx.oauth(), and ctx.linkResolver()
         * @returns {string} - The HTML output
         */
        asHtml: function(ctx) {
            var htmls = [];
            for(var field in this.fragments) {
                var fragment = this.get(field);
                htmls.push(fragment && fragment.asHtml ? '<section data-field="' + field + '">' + fragment.asHtml(ctx) + '</section>' : '');
            }
            return htmls.join('');
        },

        /**
         * Turns the document into a useable text version of it.
         *
         * @returns {string} - basic text version of the fragment
         */
         asText: function(ctx) {
            var texts = [];
            for(var field in this.fragments) {
                var fragment = this.get(field);
                texts.push(fragment && fragment.asText ? fragment.asText(ctx) : '');
            }
            return texts.join('');
         }

    };

    /**
     * Embodies a prismic.io ref (a past or future point in time you can query)
     * @constructor
     * @global
     */
    function Ref(ref, label, isMaster, scheduledAt, id) {
        /**
         * @field
         * @description the ID of the ref
         */
        this.ref = ref;
        /**
         * @field
         * @description the label of the ref
         */
        this.label = label;
        /**
         * @field
         * @description is true if the ref is the master ref
         */
        this.isMaster = isMaster;
        /**
         * @field
         * @description the scheduled date of the ref
         */
        this.scheduledAt = scheduledAt;
        /**
         * @field
         * @description the name of the ref
         */
        this.id = id;
    }
    Ref.prototype = {};

    /**
     * Api cache
     */
    function ApiCache() {
        this.cache = {};
        this.states = {};
    }

    ApiCache.prototype = {

        get: function(key) {
            var maybeEntry = this.cache[key];
            if(maybeEntry && (!this.isExpired(key) || (this.isExpired(key) && this.isInProgress(key)))) {
                return maybeEntry.data;
            } else return null;
        },

        set: function(key, value, ttl) {
            this.cache[key] = {
                data: value,
                expiredIn: ttl ? (Date.now() + (ttl * 1000)) : 0
            };
        },

        getOrSet: function(key, ttl, fvalue, done) {
            var found = this.get(key);
            var self = this;
            if(!found) {
                this.states[key] = 'progress';
                var value =  fvalue(function(error, value, xhr) {
                    self.set(key, value, ttl);
                    delete self.states[key];
                    done && done(error, value, xhr);
                });
            } else {
                done && done(null, found);
            }
        },

        isExpired: function(key) {
            var entry = this.cache[key];
            if(entry) {
                return entry.expiredIn != 0 && entry.expiredIn < Date.now();
            } else {
                return false;
            }
        },

        isInProgress: function(key) {
            return this.states[key] == 'progress';
        },

        exists: function(key) {
            return !!this.cache[key];
        },

        remove: function(key) {
            return delete this.cache[key];
        },

        clear: function(key) {
            this.cache = {};
        }
    };

    // -- Export Globally

    Global.Prismic = {
        Api: prismic
    };

}(typeof exports === 'object' && exports ? exports : (typeof module === "object" && module && typeof module.exports === "object" ? module.exports : window)));
