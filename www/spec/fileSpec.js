

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

    it("should create directory", function (done) {
        fs.root.getDirectory('PandaPics', {create: true}, function(dirEntry) {
            expect(dirEntry.isFile).toBeFalsy();
            expect(dirEntry.isDirectory).toBeTruthy();
            expect(dirEntry.name).toEqual("PandaPics");
            expect(dirEntry.fullPath).toEqual("/PandaPics");

            done();
        }, errorHandler);
    });

    it("Should return the existing directory when create is true", function(done) {
        fs.root.getDirectory('PandaPics', {create: true}, function(dirEntry) {
            expect(dirEntry.isFile).toBeFalsy();
            expect(dirEntry.isDirectory).toBeTruthy();
            expect(dirEntry.name).toEqual("PandaPics");
            expect(dirEntry.fullPath).toEqual("/PandaPics");

            done();
        }, errorHandler);
    });

    it("Should fail when creating with exclusive an existing directory", function(done) {
        fs.root.getDirectory('PandaPics', {create: true, exclusive: true}, function() {
            expect("Dir should not be created").toBeFalsy();

            done();
        }, done);
    });

    it("Should fail when opening a non existing directory with create false", function(done) {
        fs.root.getDirectory('IH8PandaPics', {create: false}, function() {
            expect("Dir should not exist").toBeFalsy();

            done();
        }, done);
    });

    it("should create subdirectory", function (done) {
        fs.root.getDirectory('PandaPics', {create: true}, function(dirEntry) {
            dirEntry.getDirectory('RedPanda', {create: true}, function(subDirEntry) {
                expect(subDirEntry.isFile).toBeFalsy();
                expect(subDirEntry.isDirectory).toBeTruthy();
                expect(subDirEntry.name).toEqual("RedPanda");
                expect(subDirEntry.fullPath).toEqual("/PandaPics/RedPanda");

                done();
            }, errorHandler);
        }, errorHandler);
    });

    it("should open subdirectory", function (done) {
        fs.root.getDirectory('PandaPics/RedPanda', {create: false}, function(subDirEntry) {
            expect(subDirEntry.isFile).toBeFalsy();
            expect(subDirEntry.isDirectory).toBeTruthy();
            expect(subDirEntry.name).toEqual("RedPanda");
            expect(subDirEntry.fullPath).toEqual("/PandaPics/RedPanda");

            done();
        }, errorHandler);
    });

    it("should create subdirectory from root", function (done) {
        fs.root.getDirectory('/PandaPics/DancePanda', {create: true}, function(subDirEntry) {
            expect(subDirEntry.isFile).toBeFalsy();
            expect(subDirEntry.isDirectory).toBeTruthy();
            expect(subDirEntry.name).toEqual("DancePanda");
            expect(subDirEntry.fullPath).toEqual("/PandaPics/DancePanda");

            done();
        }, errorHandler);
    });

    it("should remove directory", function (done) {
        fs.root.getDirectory('PandaPics/RedPanda', {create: false}, function(dirEntry) {
            expect(dirEntry.isDirectory).toBeTruthy();

            dirEntry.remove(function() {
                fs.root.getDirectory('PandaPics/RedPanda', {create: false}, function() {
                    expect("Dir should have been removed").toBeFalsy();
                }, done);
            }, errorHandler);

        }, errorHandler);
    });

    it("should remove directory recursively", function (done) {
        fs.root.getDirectory('PandaPics', {create: false}, function(dirEntry) {
            expect(dirEntry.isDirectory).toBeTruthy();

            dirEntry.removeRecursively(function() {
                fs.root.getDirectory('PandaPics', {create: false}, function() {
                    expect("Dir should have been removed").toBeFalsy();
                }, done);
            }, errorHandler);

        }, errorHandler);
    });

    describe("List folder files", function () {
        var listFs;

        it("init new fs", function (done) {
            window.requestFileSystem(window.PERSISTENT, 1024*1024, function (fs) {
                listFs = fs;
                done();
            }, errorHandler);

        });

        it("adds 2 files", function (done) {
            listFs.root.getFile('hello.panda', {create: true}, function(fileEntry) {

                expect(fileEntry.isFile).toBeTruthy();

                listFs.root.getFile('panda.world', {create: true}, function(fileEntry) {

                    expect(fileEntry.isFile).toBeTruthy();

                    done();
                }, errorHandler);
            }, errorHandler);
        });

        it("should read entries", function (done) {
            var dirReader = listFs.root.createReader();

            dirReader.readEntries(function(results) {
                expect(results.length).toEqual(2);

                expect(["/hello.panda", "/panda.world"]).toContain(results[0].fullPath);
                expect(["/hello.panda", "/panda.world"]).toContain(results[1].fullPath);

                done();
            }, errorHandler);
        });
    });
});
