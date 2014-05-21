cordova.define("org.apache.cordova.file.FileProxy", function(require, exports, module) { ﻿/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
*/

var LocalFileSystem = require('./LocalFileSystem'),
    FileSystem = require('./FileSystem'),
    FileEntry = require('./FileEntry'),
    FileError = require('./FileError'),
    DirectoryEntry = require('./DirectoryEntry'),
    File = require('./File');


    (function(exports, global) {
    var indexedDB = global.indexedDB || global.mozIndexedDB;
    if (!indexedDB)
    {
        throw "indexedDB not supported";
    }

    var NOT_IMPLEMENTED_ERR = new FileError({code: 1000,
        name: 'Not implemented'});

    var fs_ = null;

    var storageType_ = 'temporary';
    var idb_ = {};
    idb_.db = null;
    var FILE_STORE_ = 'entries';

    var DIR_SEPARATOR = '/';
    var DIR_OPEN_BOUND = String.fromCharCode(DIR_SEPARATOR.charCodeAt(0) + 1);

    exports.requestFileSystem = function(successCallback, errorCallback, args) {
        var type = args[0];
        var size = args[1];

        if (type !== LocalFileSystem.TEMPORARY && type !== LocalFileSystem.PERSISTENT) {
            if (errorCallback) {
                errorCallback(FileError.INVALID_MODIFICATION_ERR);
                return;
            }
        }

        storageType_ = type == LocalFileSystem.TEMPORARY ? 'Temporary' : 'Persistent';
        var name = (location.protocol + location.host).replace(/:/g, '_') +
            ':' + storageType_;

        var root = new DirectoryEntry('', DIR_SEPARATOR);
        var fs_ = new FileSystem(name, root);

        idb_.open(fs_.name, function() {
            successCallback(fs_);
        }, errorCallback);
    };

    // list a directory's contents (files and folders).
    var used_ = false;
    exports.readEntries = function(successCallback, errorCallback, args) {
        var dirEntry_ = args[0];
        if (!successCallback) {
            throw Error('Expected successCallback argument.');
        }

        // This is necessary to mimic the way DirectoryReader.readEntries() should
        // normally behavior.  According to spec, readEntries() needs to be called
        // until the length of result array is 0. To handle someone implementing
        // a recursive call to readEntries(), get everything from indexedDB on the
        // first shot. Then (DirectoryReader has been used), return an empty
        // result array.
        if (!used_) {
            idb_.getAllEntries(dirEntry_.fullPath, function(entries) {
                used_= true;
                successCallback(entries);
            }, errorCallback);
        } else {
            successCallback([]);
        }
    };

    exports.getFile = function(successCallback, errorCallback, args) {
        var fullpath = args[0];
        var path = args[1];
        var options = args[2] || {};

        // Create an absolute path if we were handed a relative one.
        path = resolveToFullPath_(fullpath, path);

        idb_.get(path, function(fileEntry) {
            if (options.create === true && options.exclusive === true && fileEntry) {
                // If create and exclusive are both true, and the path already exists,
                // getFile must fail.

                if (errorCallback) {
                    errorCallback(FileError.PATH_EXISTS_ERR);
                }
            } else if (options.create === true && !fileEntry) {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getFile must create it as a zero-length file and return a corresponding
                // FileEntry.
                var name = path.split(DIR_SEPARATOR).pop(); // Just need filename.
                var newFileEntry = new FileEntry(name, path, fs_);

                newFileEntry.file_ = new MyFile({
                    size: 0,
                    name: newFileEntry.name,
                    lastModifiedDate: new Date()
                });

                idb_.put(newFileEntry, successCallback, errorCallback);
            } else if (options.create === true && fileEntry) {
                if (fileEntry.isFile) {
                    successCallback(fileEntryFromIdbEntry(fileEntry));
                } else {
                    if (errorCallback) {
                        errorCallback(FileError.INVALID_MODIFICATION_ERR);
                    }
                }
            } else if ((!options.create || options.create === false) && !fileEntry) {
                // If create is not true and the path doesn't exist, getFile must fail.
                if (errorCallback) {
                    errorCallback(FileError.NOT_FOUND_ERR);
                }
            } else if ((!options.create || options.create === false) && fileEntry &&
                fileEntry.isDirectory) {
                // If create is not true and the path exists, but is a directory, getFile
                // must fail.
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
            } else {
                // Otherwise, if no other error occurs, getFile must return a FileEntry
                // corresponding to path.

                successCallback(fileEntryFromIdbEntry(fileEntry));
            }
        }, errorCallback);
    };

    exports.getFileMetadata = function(successCallback, errorCallback, args) {
        var fullPath = args[0];

        exports.getFile(function(fileEntry) {
            successCallback(new File(fileEntry.file_.name, fileEntry.fullPath, '', fileEntry.file_.lastModifiedDate,
                fileEntry.file_.size));
        }, errorCallback, [null, fullPath]);
    };

    exports.write = function(successCallback, errorCallback, args) {
        var fileName = args[0],
            data = args[1],
            position = args[2],
            isBinary = args[3];

        if (!data) {
            errorCallback(FileError.INVALID_MODIFICATION_ERR);
            return;
        }

        exports.getFile(function(fileEntry) {
            var blob_ =  fileEntry.file_.blob_;

            if (!blob_) {
                blob_ = new Blob([data], {type: data.type});
            } else {
                // Calc the head and tail fragments
                var head = blob_.slice(0, position);
                var tail = blob_.slice(position + data.byteLength);

                // Calc the padding
                var padding = position - head.size;
                if (padding < 0) {
                    padding = 0;
                }

                // Do the "write". In fact, a full overwrite of the Blob.
                blob_ = new Blob([head, new Uint8Array(padding), data, tail],
                    {type: data.type});
            }

            // Set the blob we're writing on this file entry so we can recall it later.
            fileEntry.file_.blob_ = blob_;
            fileEntry.file_.lastModifiedDate = data.lastModifiedDate || null;
            fileEntry.file_.size = blob_.size;
            fileEntry.file_.name = blob_.name;
            fileEntry.file_.type = blob_.type;

            idb_.put(fileEntry, function(entry) {
                successCallback(data.byteLength);
            }, errorCallback);
        }, errorCallback, [null, fileName]);
    };

    exports.readAsText = function(successCallback, errorCallback, args) {
        var fileName = args[0],
            enc = args[1],
            startPos = args[2],
            endPos = args[3];

        readAs('text', fileName, enc, startPos, endPos, successCallback, errorCallback);
    };

    exports.readAsDataURL = function(successCallback, errorCallback, args) {
        var fileName = args[0],
            startPos = args[1],
            endPos = args[2];

        readAs('dataURL', fileName, null, startPos, endPos, successCallback, errorCallback);
    };

    exports.readAsBinaryString = function(successCallback, errorCallback, args) {
        var fileName = args[0],
            startPos = args[1],
            endPos = args[2];

        readAs('binaryString', fileName, null, startPos, endPos, successCallback, errorCallback);
    };

    exports.readAsArrayBuffer = function(successCallback, errorCallback, args) {
        var fileName = args[0],
            startPos = args[1],
            endPos = args[2];

        readAs('arrayBuffer', fileName, null, startPos, endPos, successCallback, errorCallback);
    };

    exports.remove = function(successCallback, errorCallback, args) {
        var fullPath = args[0];

        // TODO: This doesn't protect against directories that have content in it.
        // Should throw an error instead if the dirEntry is not empty.
        idb_['delete'](fullPath, function() {
            successCallback();
        }, errorCallback);
    };







    // When saving an entry, the fullPath should always lead with a slash and never
    // end with one (e.g. a directory). Also, resolve '.' and '..' to an absolute
    // one. This method ensures path is legit!
    function resolveToFullPath_(cwdFullPath, path) {
        var fullPath = path;

        var relativePath = path[0] != DIR_SEPARATOR;
        if (relativePath) {
            fullPath = cwdFullPath;
            if (cwdFullPath != DIR_SEPARATOR) {
                fullPath += DIR_SEPARATOR + path;
            } else {
                fullPath += path;
            }
        }

        // Adjust '..'s by removing parent directories when '..' flows in path.
        var parts = fullPath.split(DIR_SEPARATOR);
        for (var i = 0; i < parts.length; ++i) {
            var part = parts[i];
            if (part == '..') {
                parts[i - 1] = '';
                parts[i] = '';
            }
        }
        fullPath = parts.filter(function(el) {
            return el;
        }).join(DIR_SEPARATOR);

        // Add back in leading slash.
        if (fullPath[0] != DIR_SEPARATOR) {
            fullPath = DIR_SEPARATOR + fullPath;
        }

        // Replace './' by current dir. ('./one/./two' -> one/two)
        fullPath = fullPath.replace(/\.\//g, DIR_SEPARATOR);

        // Replace '//' with '/'.
        fullPath = fullPath.replace(/\/\//g, DIR_SEPARATOR);

        // Replace '/.' with '/'.
        fullPath = fullPath.replace(/\/\./g, DIR_SEPARATOR);

        // Remove '/' if it appears on the end.
        if (fullPath[fullPath.length - 1] == DIR_SEPARATOR &&
            fullPath != DIR_SEPARATOR) {
            fullPath = fullPath.substring(0, fullPath.length - 1);
        }

        return fullPath;
    }

    function fileEntryFromIdbEntry(fileEntry) {
        // IDB won't save methods, so we need re-create the FileEntry.
        var clonedFileEntry = new FileEntry(fileEntry.name, fileEntry.fullPath, fileEntry.fileSystem);
        clonedFileEntry.file_ = fileEntry.file_;

        return clonedFileEntry;
    }

    function readAs(what, fullPath, encoding, startPos, endPos, successCallback, errorCallback) {
        exports.getFile(function(fileEntry) {
            var fileReader = new FileReader(),
                blob = fileEntry.file_.blob_.slice(startPos, endPos);

            fileReader.onload = function (e) {
                successCallback(e.target.result);
            };

            fileReader.onerror = errorCallback;

            switch(what) {
                case 'text':
                    fileReader.readAsText(blob, encoding);
                    break;
                case 'dataURL':
                    fileReader.readAsDataURL(blob);
                    break;
                case 'arrayBuffer':
                    fileReader.readAsArrayBuffer(blob);
                    break;
                case 'binaryString':
                    fileReader.readAsBinaryString(blob);
                    break;
            }

        }, errorCallback, [null, fullPath]);
    }











    /**
     * Interface to wrap the native File interface.
     *
     * This interface is necessary for creating zero-length (empty) files,
     * something the Filesystem API allows you to do. Unfortunately, File's
     * constructor cannot be called directly, making it impossible to instantiate
     * an empty File in JS.
     *
     * @param {Object} opts Initial values.
     * @constructor
     */
    function MyFile(opts) {
        var blob_ = null;

        this.size = opts.size || 0;
        this.name = opts.name || '';
        this.type = opts.type || '';
        this.lastModifiedDate = opts.lastModifiedDate || null;

        // Need some black magic to correct the object's size/name/type based on the
        // blob that is saved.
        Object.defineProperty(this, 'blob_', {
            enumerable: true,
            get: function() {
                return blob_;
            },
            set: function (val) {
                blob_ = val;
                this.size = blob_.size;
                this.name = blob_.name;
                this.type = blob_.type;
                this.lastModifiedDate = blob_.lastModifiedDate;
            }.bind(this)
        });
    }
    MyFile.prototype.constructor = MyFile;

    /**
     * Interface supplies information about the state of a file or directory.
     *
     * Modeled from:
     * dev.w3.org/2009/dap/file-system/file-dir-sys.html#idl-def-Metadata
     *
     * @constructor
     */
    function Metadata(modificationTime, size) {
        this.modificationTime_ = modificationTime || null;
        this.size_ = size || 0;
    }

    Metadata.prototype = {
        get modificationTime() {
            return this.modificationTime_;
        },
        get size() {
            return this.size_;
        }
    }

    /**
     * Interface representing entries in a filesystem, each of which may be a File
     * or MyDirectoryEntry.
     *
     * Modeled from:
     * dev.w3.org/2009/dap/file-system/pub/FileSystem/#idl-def-Entry
     *
     * @constructor
     */
    function MyEntry() {}

    MyEntry.prototype = {
        name: null,
        fullPath: null,
        filesystem: null,
        copyTo: function() {
            throw FileError.NOT_IMPLEMENTED_ERR;
        },
        getMetadata: function(successCallback, errorCallback) {
            if (!successCallback) {
                throw Error('Expected successCallback argument.');
            }

            try {
                if (this.isFile) {
                    successCallback(
                        new Metadata(this.file_.lastModifiedDate, this.file_.size));
                } else {
                    errorCallback(new MyFileError({code: 1001,
                        name: 'getMetadata() not implemented for MyDirectoryEntry'}));
                }
            } catch(e) {
                errorCallback && errorCallback(e);
            }
        },
        getParent: function() {
            throw NOT_IMPLEMENTED_ERR;
        },
        moveTo: function() {
            throw NOT_IMPLEMENTED_ERR;
        },
        remove: function(successCallback, errorCallback) {
            if (!successCallback) {
                throw Error('Expected successCallback argument.');
            }
            // TODO: This doesn't protect against directories that have content in it.
            // Should throw an error instead if the dirEntry is not empty.
            idb_['delete'](this.fullPath, function() {
                successCallback();
            }, errorCallback);
        },
        toURL: function() {
            var origin = location.protocol + '//' + location.host;
            return 'filesystem:' + origin + DIR_SEPARATOR + storageType_.toLowerCase() +
                this.fullPath;
        },
    };

    /**
     * Interface representing a file in the filesystem.
     *
     * Modeled from:
     * dev.w3.org/2009/dap/file-system/pub/FileSystem/#the-fileentry-interface
     *
     * @param {FileEntry} opt_fileEntry Optional FileEntry to initialize this
     *     object from.
     * @constructor
     * @extends {MyEntry}
     */
    function MyFileEntry(opt_fileEntry) {
        this.file_ = null;

        Object.defineProperty(this, 'isFile', {
            enumerable: true,
            get: function() {
                return true;
            }
        });
        Object.defineProperty(this, 'isDirectory', {
            enumerable: true,
            get: function() {
                return false;
            }
        });

        // Create this entry from properties from an existing MyFileEntry.
        if (opt_fileEntry) {
            this.file_ = opt_fileEntry.file_;
            this.name = opt_fileEntry.name;
            this.fullPath = opt_fileEntry.fullPath;
            this.filesystem = opt_fileEntry.filesystem;
        }
    }
    MyFileEntry.prototype = new MyEntry();
    MyFileEntry.prototype.constructor = MyFileEntry;
    MyFileEntry.prototype.createWriter = function(callback) {
        // TODO: figure out if there's a way to dispatch onwrite event as we're writing
        // data to IDB. Right now, we're only calling onwritend/onerror
        // MyFileEntry.write().
        callback(new FileWriter(this));
    };
    MyFileEntry.prototype.file = function(successCallback, errorCallback) {
        if (!successCallback) {
            throw Error('Expected successCallback argument.');
        }

        if (this.file_ == null) {
            if (errorCallback) {
                errorCallback(FileError.NOT_FOUND_ERR);
            } else {
                throw FileError.NOT_FOUND_ERR;
            }
            return;
        }

        // If we're returning a zero-length (empty) file, return the fake file obj.
        // Otherwise, return the native File object that we've stashed.
        var file = this.file_.blob_ == null ? this.file_ : this.file_.blob_;
        file.lastModifiedDate = this.file_.lastModifiedDate;

        // Add Blob.slice() to this wrapped object. Currently won't work :(
        /*if (!val.slice) {
         val.slice = Blob.prototype.slice; // Hack to add back in .slice().
         }*/
        successCallback(file);
    };

    /**
     * Interface representing a directory in the filesystem.
     *
     * Modeled from:
     * dev.w3.org/2009/dap/file-system/pub/FileSystem/#the-directoryentry-interface
     *
     * @param {MyDirectoryEntry} opt_folderEntry Optional MyDirectoryEntry to
     *     initialize this object from.
     * @constructor
     * @extends {MyEntry}
     */
    function MyDirectoryEntry(opt_folderEntry) {
        Object.defineProperty(this, 'isFile', {
            enumerable: true,
            get: function() {
                return false;
            }
        });
        Object.defineProperty(this, 'isDirectory', {
            enumerable: true,
            get: function() {
                return true;
            }
        });

        // Create this entry from properties from an existing MyDirectoryEntry.
        if (opt_folderEntry) {
            this.name = opt_folderEntry.name;
            this.fullPath = opt_folderEntry.fullPath;
            this.filesystem = opt_folderEntry.filesystem;
        }
    }
    MyDirectoryEntry.prototype = new MyEntry();
    MyDirectoryEntry.prototype.constructor = MyDirectoryEntry;
    MyDirectoryEntry.prototype.createReader = function() {
        return new DirectoryReader(this);
    };
    MyDirectoryEntry.prototype.getDirectory = function(path, options, successCallback,
                                                     errorCallback) {

        // Create an absolute path if we were handed a relative one.
        path = resolveToFullPath_(this.fullPath, path);

        idb_.get(path, function(folderEntry) {
            if (!options) {
                options = {};
            }

            if (options.create === true && options.exclusive === true && folderEntry) {
                // If create and exclusive are both true, and the path already exists,
                // getDirectory must fail.
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
            } else if (options.create === true && !folderEntry) {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getDirectory must create it as a zero-length file and return a corresponding
                // MyDirectoryEntry.
                var dirEntry = new MyDirectoryEntry();
                dirEntry.name = path.split(DIR_SEPARATOR).pop(); // Just need filename.
                dirEntry.fullPath = path;
                dirEntry.filesystem = fs_;

                idb_.put(dirEntry, successCallback, errorCallback);
            } else if (options.create === true && folderEntry) {

                if (folderEntry.isDirectory) {
                    // IDB won't save methods, so we need re-create the MyDirectoryEntry.
                    successCallback(new MyDirectoryEntry(folderEntry));
                } else {
                    if (errorCallback) {
                        errorCallback(FileError.INVALID_MODIFICATION_ERR);
                        return;
                    }
                }
            } else if ((!options.create || options.create === false) && !folderEntry) {
                // Handle root special. It should always exist.
                if (path == DIR_SEPARATOR) {
                    folderEntry = new MyDirectoryEntry();
                    folderEntry.name = '';
                    folderEntry.fullPath = DIR_SEPARATOR;
                    folderEntry.filesystem = fs_;
                    successCallback(folderEntry);
                    return;
                }

                // If create is not true and the path doesn't exist, getDirectory must fail.
                if (errorCallback) {
                    errorCallback(FileError.NOT_FOUND_ERR);
                    return;
                }
            } else if ((!options.create || options.create === false) && folderEntry &&
                folderEntry.isFile) {
                // If create is not true and the path exists, but is a file, getDirectory
                // must fail.
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                    return;
                }
            } else {
                // Otherwise, if no other error occurs, getDirectory must return a
                // MyDirectoryEntry corresponding to path.

                // IDB won't' save methods, so we need re-create MyDirectoryEntry.
                successCallback(new MyDirectoryEntry(folderEntry));
            }
        }, errorCallback);
    };

    MyDirectoryEntry.prototype.removeRecursively = function(successCallback,
                                                          errorCallback) {
        if (!successCallback) {
            throw Error('Expected successCallback argument.');
        }

        this.remove(successCallback, errorCallback);
    };


    function resolveLocalFileSystemURL(url, callback, errorCallback) {
        if (errorCallback) {
            errorCallback(NOT_IMPLEMENTED_ERR);
            return;
        }
    }

// Core logic to handle IDB operations =========================================

    idb_.open = function(dbName, successCallback, errorCallback) {
        var self = this;

        // TODO: FF 12.0a1 isn't liking a db name with : in it.
        var request = indexedDB.open(dbName.replace(':', '_')/*, 1 /*version*/);

        request.onerror = errorCallback || onError;

        request.onupgradeneeded = function(e) {
            // First open was called or higher db version was used.

            // console.log('onupgradeneeded: oldVersion:' + e.oldVersion,
            //           'newVersion:' + e.newVersion);

            self.db = e.target.result;
            self.db.onerror = onError;

            if (!self.db.objectStoreNames.contains(FILE_STORE_)) {
                var store = self.db.createObjectStore(FILE_STORE_/*,{keyPath: 'id', autoIncrement: true}*/);
            }
        };

        request.onsuccess = function(e) {
            self.db = e.target.result;
            self.db.onerror = onError;
            successCallback(e);
        };

        request.onblocked = errorCallback || onError;
    };

    idb_.close = function() {
        this.db.close();
        this.db = null;
    };

// TODO: figure out if we should ever call this method. The filesystem API
// doesn't allow you to delete a filesystem once it is 'created'. Users should
// use the public remove/removeRecursively API instead.
    idb_.drop = function(successCallback, errorCallback) {
        if (!this.db) {
            return;
        }

        var dbName = this.db.name;

        var request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = function(e) {
            successCallback(e);
        };
        request.onerror = errorCallback || onError;

        idb_.close();
    };

    idb_.get = function(fullPath, successCallback, errorCallback) {
        if (!this.db) {
            return;
        }

        var tx = this.db.transaction([FILE_STORE_], 'readonly');

        //var request = tx.objectStore(FILE_STORE_).get(fullPath);
        var range = IDBKeyRange.bound(fullPath, fullPath + DIR_OPEN_BOUND,
            false, true);
        var request = tx.objectStore(FILE_STORE_).get(range);

        tx.onabort = errorCallback || onError;
        tx.oncomplete = function(e) {
            successCallback(request.result);
        };
    };

    idb_.getAllEntries = function(fullPath, successCallback, errorCallback) {
        if (!this.db) {
            return;
        }

        var results = [];

        //var range = IDBKeyRange.lowerBound(fullPath, true);
        //var range = IDBKeyRange.upperBound(fullPath, true);

        // Treat the root entry special. Querying it returns all entries because
        // they match '/'.
        var range = null;
        if (fullPath != DIR_SEPARATOR) {
            //console.log(fullPath + '/', fullPath + DIR_OPEN_BOUND)
            range = IDBKeyRange.bound(
                    fullPath + DIR_SEPARATOR, fullPath + DIR_OPEN_BOUND, false, true);
        }

        var tx = this.db.transaction([FILE_STORE_], 'readonly');
        tx.onabort = errorCallback || onError;
        tx.oncomplete = function(e) {
            // TODO: figure out how to do be range queries instead of filtering result
            // in memory :(
            results = results.filter(function(val) {
                var valPartsLen = val.fullPath.split(DIR_SEPARATOR).length;
                var fullPathPartsLen = fullPath.split(DIR_SEPARATOR).length;

                if (fullPath == DIR_SEPARATOR && valPartsLen < fullPathPartsLen + 1) {
                    // Hack to filter out entries in the root folder. This is inefficient
                    // because reading the entires of fs.root (e.g. '/') returns ALL
                    // results in the database, then filters out the entries not in '/'.
                    return val;
                } else if (fullPath != DIR_SEPARATOR &&
                    valPartsLen == fullPathPartsLen + 1) {
                    // If this a subfolder and entry is a direct child, include it in
                    // the results. Otherwise, it's not an entry of this folder.
                    return val;
                }
            });

            successCallback(results);
        };

        var request = tx.objectStore(FILE_STORE_).openCursor(range);

        request.onsuccess = function(e) {
            var cursor = e.target.result;
            if (cursor) {
                var val = cursor.value;

                results.push(val.isFile ? new FileEntry(val) : new MyDirectoryEntry(val));
                cursor['continue']();
            }
        };
    };

    idb_['delete'] = function(fullPath, successCallback, errorCallback) {
        if (!this.db) {
            return;
        }

        var tx = this.db.transaction([FILE_STORE_], 'readwrite');
        tx.oncomplete = successCallback;
        tx.onabort = errorCallback || onError;

        //var request = tx.objectStore(FILE_STORE_).delete(fullPath);
        var range = IDBKeyRange.bound(
            fullPath, fullPath + DIR_OPEN_BOUND, false, true);
        var request = tx.objectStore(FILE_STORE_)['delete'](range);
    };

    idb_.put = function(entry, successCallback, errorCallback) {
        if (!this.db) {
            return;
        }

        var tx = this.db.transaction([FILE_STORE_], 'readwrite');
        tx.onabort = errorCallback || onError;
        tx.oncomplete = function(e) {
            // TODO: Error is thrown if we pass the request event back instead.
            successCallback(entry);
        };

        var request = tx.objectStore(FILE_STORE_).put(entry, entry.fullPath);
    };

// Global error handler. Errors bubble from request, to transaction, to db.
    function onError(e) {
        switch (e.target.errorCode) {
            case 12:
                console.log('Error - Attempt to open db with a lower version than the ' +
                    'current one.');
                break;
            default:
                console.log('errorCode: ' + e.target.errorCode);
        }

        console.log(e, e.code, e.message);
    }

// Clean up.
// TODO: decide if this is the best place for this.
//    global.addEventListener('beforeunload', function(e) {
//        idb_.db && idb_.db.close();
//    }, false);

//exports.idb = idb_;
    exports.resolveLocalFileSystemURL = resolveLocalFileSystemURL;
})(module.exports, window); // Don't use window because we want to run in workers.

require("cordova/exec/proxy").add("File", module.exports);

});
