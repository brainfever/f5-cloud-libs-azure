/**
 * Copyright 2017 F5 Networks, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

var fs = require('fs');
var q = require('q');
var azureMock;
var azureNetworkMock;
var bigIpMock;
var utilMock;
var AzureAutoscaleProvider;
var provider;

var clientId = 'myClientId';
var secret = 'mySecret';
var tenantId = 'myTenantId';
var subscriptionId = 'mySubscriptionId';

var ipAddress = '1.2.3.4';

var createdMasterFile;
var fsOpenSync;
var fsCloseSync;

// Our tests cause too many event listeners. Turn off the check.
process.setMaxListeners(0);

module.exports = {
    setUp: function(callback) {
        utilMock = require('f5-cloud-libs').util;
        azureMock = require('ms-rest-azure');
        azureNetworkMock = require('azure-arm-network');
        bigIpMock = require('f5-cloud-libs').bigIp;

        AzureAutoscaleProvider = require('../../lib/azureAutoscaleProvider');

        provider = new AzureAutoscaleProvider({clOptions: {user: 'foo', password: 'bar'}});

        callback();
    },

    tearDown: function(callback) {
        Object.keys(require.cache).forEach(function(key) {
            delete require.cache[key];
        });
        callback();
    },

    testInit: {
        setUp: function(callback) {
            utilMock.getDataFromUrl = function() {
                return q(JSON.stringify({
                    clientId: clientId,
                    secret: secret,
                    tenantId: tenantId,
                    subscriptionId: subscriptionId
                }));
            };

            azureMock.loginWithServicePrincipalSecret = function(clientId, secret, tenantId, cb) {
                cb(null, {signRequest: function() {}});
            };

            callback();
        },

        testAzureLogin: function(test) {
            var providerOptions = {
                scaleSet: 'myScaleSet',
                resourceGroup: 'myResourceGroup'
            };

            var receivedClientId;
            var receivedSecret;
            var receivedTenantId;

            azureMock.loginWithServicePrincipalSecret = function(clientId, secret, tenantId, cb) {
                receivedClientId = clientId;
                receivedSecret = secret;
                receivedTenantId = tenantId;
                cb(null, {signRequest: function() {}});
            };

            provider.init(providerOptions)
                .then(function() {
                    test.strictEqual(receivedClientId, clientId);
                    test.strictEqual(receivedSecret, secret);
                    test.strictEqual(receivedTenantId, tenantId);
                    test.done();
                });
        },

        testAzureLoginBadCredentialsUrl: function(test) {
            var errorMessage = 'bad url';
            utilMock.getDataFromUrl = function() {
                return q.reject(new Error(errorMessage));
            };

            test.expect(1);
            provider.init({})
                .then(function() {
                    test.ok(false, 'Should have thrown bad url');
                })
                .catch(function(err) {
                    test.strictEqual(err.message, errorMessage);
                })
                .finally(function() {
                    test.done();
                });
        }
    },

    testGetInstanceId: {
        setUp: function(callback) {
            bigIpMock.list = function() {
                return q([
                            {
                                address: ipAddress + '/24'
                            }
                         ]);
            };

            azureNetworkMock.networkInterfaces = {
                listVirtualMachineScaleSetNetworkInterfaces: function(resourceGroup, scaleSet, cb) {
                    cb(null, {
                        '123': {
                            ipConfigurations: [
                                {
                                    privateIPAddress: '5.6.7.8'
                                }
                            ]
                        },
                        '456': {
                            ipConfigurations: [
                                {
                                    privateIPAddress: ipAddress
                                }
                            ]
                        }
                    });
                }
            };

            provider.bigIp = bigIpMock;
            provider.networkClient = azureNetworkMock;

            callback();
        },

        testBasic: function(test) {
            provider.getInstanceId()
                .then(function(instanceId) {
                    test.strictEqual(instanceId, '456');
                })
                .catch(function(err) {
                    test.ok(false, err);
                })
                .finally(function() {
                    test.done();
                });
        },

        testCached: function(test) {
            provider.instanceId = '789';
            provider.getInstanceId()
                .then(function(instanceId) {
                    test.strictEqual(instanceId, '789');
                })
                .catch(function(err) {
                    test.ok(false, err);
                })
                .finally(function() {
                    test.done();
                });
        },

        testIpNotFound: function(test) {
            azureNetworkMock.networkInterfaces = {
                listVirtualMachineScaleSetNetworkInterfaces: function(resourceGroup, scaleSet, cb) {
                    cb(null, {
                        '123': {
                            ipConfigurations: [
                                {
                                    privateIPAddress: '5.6.7.8'
                                }
                            ]
                        },
                        '456': {
                            ipConfigurations: [
                                {
                                    privateIPAddress: '7.8.9.0'
                                }
                            ]
                        }
                    });
                }
            };

            provider.getInstanceId()
                .then(function() {
                    test.ok(false, 'should have thrown ip not found');
                })
                .catch(function(err) {
                    test.notStrictEqual(err.message.indexOf('was not found'), -1);
                })
                .finally(function() {
                    test.done();
                });

        },

        testBigIpError: function(test) {
            var errorMessage = 'foobar';

            bigIpMock.list = function() {
                return q.reject(new Error(errorMessage));
            };

            provider.getInstanceId()
                .then(function() {
                    test.ok(false, 'should have thrown network error');
                })
                .catch(function(err) {
                    test.strictEqual(err.message, errorMessage);
                })
                .finally(function() {
                    test.done();
                });
        },

        testNetworkClientError: function(test) {
            var errorMessage = 'foobar';
            azureNetworkMock.networkInterfaces = {
                listVirtualMachineScaleSetNetworkInterfaces: function(resourceGroup, scaleSet, cb) {
                    cb(new Error(errorMessage), {});
                }
            };

            provider.getInstanceId()
                .then(function() {
                    test.ok(false, 'should have thrown network error');
                })
                .catch(function(err) {
                    test.strictEqual(err.message, errorMessage);
                })
                .finally(function() {
                    test.done();
                });
        }
    },

    testGetInstances: {
        setUp: function(callback) {
            bigIpMock.prototype.init = function(host) {
                this.host = host;
                return q();
            };

            bigIpMock.prototype.list = function() {
                return q({
                    hostname: this.host + '_myHostname'
                });
            };

            azureNetworkMock.networkInterfaces = {
                listVirtualMachineScaleSetNetworkInterfaces: function(resourceGroup, scaleSet, cb) {
                    cb(null, {
                        '123': {
                            ipConfigurations: [
                                {
                                    privateIPAddress: '5.6.7.8'
                                }
                            ]
                        },
                        '456': {
                            ipConfigurations: [
                                {
                                    privateIPAddress: '7.8.9.0'
                                }
                            ]
                        }
                    });
                }
            };

            provider.networkClient = azureNetworkMock;

            callback();
        },

        testBasic: function(test) {
            provider.getInstances()
                .then(function(instances) {
                    test.deepEqual(instances, {
                        '123': {
                            mgmtIp: '5.6.7.8',
                            privateIp: '5.6.7.8',
                            hostname: '5.6.7.8_myHostname'
                        },
                        '456': {
                            mgmtIp: '7.8.9.0',
                            privateIp: '7.8.9.0',
                            hostname: '7.8.9.0_myHostname'
                        }
                    });
                })
                .catch(function(err) {
                    test.ok(false, err);
                })
                .finally(function() {
                    test.done();
                });
        },

        testError: function(test) {
            var errorMessage = 'some error occurred';
            bigIpMock.prototype.init = function() {
                return q.reject(new Error(errorMessage));
            };

            test.expect(1);

            provider.getInstances()
                .then(function() {
                    test.ok(false, 'should have thrown');
                })
                .catch(function(err) {
                    test.strictEqual(err.message, errorMessage);
                })
                .finally(function() {
                    test.done();
                });
        }
    },

    testElectMaster: {
        testBasic: function(test) {
            var instances = {
                '123': {
                    mgmtIp: '5.6.7.8',
                    privateIp: '5.6.7.8',
                    hostname: '5.6.7.8_myHostname'
                },
                '456': {
                    mgmtIp: '7.8.9.0',
                    privateIp: '7.8.9.0',
                    hostname: '7.8.9.0_myHostname'
                }
            };

            provider.electMaster(instances)
                .then(function(electedId) {
                    test.strictEqual(electedId, '123');
                    test.done();
                });
        },

        testNoInstances: function(test) {
            var instances = [];

            test.expect(1);
            provider.electMaster(instances)
                .then(function() {
                    test.ok(false, 'should have thrown no instances');
                })
                .catch(function(err) {
                    test.strictEqual(err.message, 'No instances');
                })
                .finally(function() {
                    test.done();
                });
        }
    },

    testGetMasterCredentials: function(test) {
        var user = 'roger';
        var password = 'dodger';

        bigIpMock.user = user;
        bigIpMock.password = password;
        provider.bigIp = bigIpMock;
        provider.getMasterCredentials()
            .then(function(credentials) {
                test.deepEqual(credentials, {
                    username: user,
                    password: password
                });
                test.done();
            });
    },

    testMasterElected: {
        setUp: function(callback) {
            createdMasterFile = false;

            provider.instanceId = '123';
            fsOpenSync = fs.openSync;
            fsCloseSync = fs.closeSync;

            fs.openSync = function() {
                createdMasterFile = true;
            };
            fs.closeSync = function() {};

            callback();
        },

        tearDown: function(callback) {
            fs.openSync = fsOpenSync;
            fs.closeSync = fsCloseSync;
            callback();
        },

        testIsMaster: function(test) {
            provider.masterElected('123')
                .then(function() {
                    test.strictEqual(createdMasterFile, true);
                    test.done();
                });
        },

        testNotMaster: function(test) {
            provider.masterElected('456')
                .then(function() {
                    test.strictEqual(createdMasterFile, false);
                    test.done();
                });
        }
    }
};