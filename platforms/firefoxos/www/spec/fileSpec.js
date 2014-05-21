

describe("File System", function() {
    var fs;

    function errorHandler(e) {
        throw e.code;
    }

    it("Clear db. Ugh, ugly. Where is setup?", function (done) {
        var indexedDB = window.indexedDB || window.mozIndexedDB;

        var namePrefix = (location.protocol + location.host).replace(/:/g, '_') + '_';
        var count = 0;

        var types = [
            'Temporary',
            'Persistent'
        ];

        types.forEach(function(type) {
            var databaseName = namePrefix + type;
            var req = indexedDB.deleteDatabase(databaseName);
            req.onsuccess = function() {
                console.log("Deleted database successfully");

                count++;
                if (count === types.length) {
                    done();
                }
            };

            req.onerror = function() {
                console.log("Couldn't delete database");
            };
        });
    });

    it("Should create a file system", function(done) {
        expect(window.requestFileSystem).toBeTruthy();

        function onInitFs(_fs) {
            fs = _fs;

            done();
        }

        window.requestFileSystem(window.TEMPORARY, 5 * 1024 * 1024, onInitFs);
    });

    describe("getFile", function() {
        it("Should create files", function(done) {
            fs.root.getFile('test.txt', {create: true, exclusive: true}, function(fileEntry) {

                expect(fileEntry.isFile).toBeTruthy();
                expect(fileEntry.isDirectory).toBeFalsy();
                expect(fileEntry.name).toEqual("test.txt");
                expect(fileEntry.fullPath).toEqual("/test.txt");

                done();
            }, errorHandler);
        });

        it("Should return the existing file when create is true", function(done) {
            fs.root.getFile('test.txt', {create: true}, function(fileEntry) {
                expect(fileEntry.isFile).toBeTruthy();
                expect(fileEntry.isDirectory).toBeFalsy();
                expect(fileEntry.name).toEqual("test.txt");
                expect(fileEntry.fullPath).toEqual("/test.txt");

                done();
            }, errorHandler);
        });

        it("Should fail when creating with exclusive an existing file", function(done) {
            fs.root.getFile('test.txt', {create: true, exclusive: true}, function(fileEntry) {
                expect("File should not be created").toBeFalsy();

                done();
            }, done);
        });

        it("Should fail when opening a non existing file", function(done) {
            fs.root.getFile('whereistest.txt', {create: false}, function(fileEntry) {
                expect("File should not exist").toBeFalsy();

                done();
            }, done);
        });

        //TODO test directories
    });

    it("Should create a writer", function (done) {
        fs.root.getFile('write.txt', {create: true}, function(fileEntry) {
            fileEntry.createWriter(function(fileWriter) {
                done();
            }, errorHandler);
        }, errorHandler);
    });

    it("Should write file", function (done) {
        fs.root.getFile('write.txt', {create: true}, function(fileEntry) {
            fileEntry.createWriter(function(fileWriter) {

                fileWriter.onwriteend = function(e) {
                    done();
                };

                fileWriter.onerror = function(e) {
                    expect("Failed to write").toBeFalsy();
                };

                var blob = new Blob(['Happy Panda'], {type: 'text/plain'});

                fileWriter.write(blob);
            }, errorHandler);
        }, errorHandler);
    });

    it("Should read file", function (done) {
        fs.root.getFile('write.txt', {create: false}, function(fileEntry) {
            fileEntry.file(function(file) {
                var reader = new FileReader();

                reader.onloadend = function() {
                    expect(this.result).toEqual('Happy Panda');

                    done();
                };

                reader.readAsText(file);
            }, errorHandler);
        }, errorHandler);
    });

    it("Should append to file", function (done) {
        fs.root.getFile('write.txt', {create: false}, function(fileEntry) {
            fileEntry.createWriter(function(fileWriter) {
                fileWriter.onwriteend = function(e) {
                    check(done);
                };

                fileWriter.seek(fileWriter.length); // Start write position at EOF.

                // Create a new Blob and write it to log.txt.
                var blob = new Blob([' is happy'], {type: 'text/plain'});

                fileWriter.write(blob);
            }, errorHandler);
        }, errorHandler);

        function check(done) {
            fs.root.getFile('write.txt', {create: false}, function(fileEntry) {
                fileEntry.file(function(file) {
                    var reader = new FileReader();

                    reader.onloadend = function() {
                        expect(this.result).toEqual('Happy Panda is happy');

                        done();
                    };

                    reader.readAsText(file);
                }, errorHandler);
            }, errorHandler);
        }
    });

    it("should remove file", function (done) {
        fs.root.getFile('write.txt', {create: false}, function(fileEntry) {

            fileEntry.remove(function() {
                check(done);
            }, errorHandler);

        }, errorHandler);

        function check(done) {
            fs.root.getFile('write.txt', {create: false}, function(fileEntry) {
                expect("File should not exist").toBeFalsy();

                done();
            }, done);
        }
    });
});
