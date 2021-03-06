/**
 * Copyright 2017-2018 F5 Networks, Inc.
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

process.env.NODE_PATH = `${__dirname}/../../../`;
require('module').Module._initPaths(); // eslint-disable-line no-underscore-dangle

const q = require('q');

const clientId = 'myClientId';
const secret = 'mySecret';
const tenantId = 'myTenantId';
const subscriptionId = 'mySubscriptionId';
const storageAccount = 'myStorageAccount';
const storageKey = 'myStorageKey';

let ucsEntries = [];

let authnMock;
let icontrolMock;
let azureMock;
let azureNetworkMock;
let azureStorageMock;
let azureComputeMock;
let bigIpMock;
let utilMock;
let localCryptoUtilMock;
let AzureCloudProvider;
let AutoscaleInstance;
let provider;
let createBlobFromTextParams;
let virtualMachineScaleSetUpdateParams;

let getBlobToTextParams;

let receivedClientId;
let receivedSecret;
let receivedTenantId;
let receivedAzureEnvironment;

let azureLocation;
let deleteBlobIfExistsCalled = false;
// Our tests cause too many event listeners. Turn off the check.
process.setMaxListeners(0);

module.exports = {
    setUp(callback) {
        /* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, global-require */
        utilMock = require('@f5devcentral/f5-cloud-libs').util;
        localCryptoUtilMock = require('@f5devcentral/f5-cloud-libs').localCryptoUtil;
        azureMock = require('ms-rest-azure');
        azureNetworkMock = require('azure-arm-network');
        azureStorageMock = require('azure-storage');
        azureComputeMock = require('azure-arm-compute');
        bigIpMock = require('@f5devcentral/f5-cloud-libs').bigIp;
        authnMock = require('@f5devcentral/f5-cloud-libs').authn;
        icontrolMock = require('@f5devcentral/f5-cloud-libs').iControl;

        AzureCloudProvider = require('../../lib/azureCloudProvider');
        AutoscaleInstance = require('@f5devcentral/f5-cloud-libs').autoscaleInstance;
        /* eslint-enable import/no-extraneous-dependencies, import/no-unresolved, global-require */

        utilMock.getProduct = function getProduct() {
            return q('BIG-IP');
        };

        provider = new AzureCloudProvider({ clOptions: { user: 'foo', password: 'bar' } });
        provider.resourceGroup = 'my resource group';

        azureStorageMock.createBlobService = function createBlobService() {
            return {
                createContainerIfNotExists(container, cb) {
                    cb();
                }
            };
        };

        callback();
    },

    tearDown(callback) {
        Object.keys(require.cache).forEach((key) => {
            delete require.cache[key];
        });
        callback();
    },

    testInit: {
        setUp(callback) {
            const credentialsBlob = {
                clientId,
                secret,
                tenantId,
                subscriptionId,
                storageAccount,
                storageKey
            };

            azureLocation = 'westus';

            utilMock.getDataFromUrl = function getDataFromUrl(url) {
                if (url.indexOf('http://169.254.169.254') !== -1) {
                    return q({
                        compute: {
                            location: azureLocation
                        }
                    });
                }
                return q(JSON.stringify(credentialsBlob));
            };

            localCryptoUtilMock.symmetricDecryptPassword = function symmetricDecryptPassword() {
                return q(JSON.stringify(credentialsBlob));
            };

            azureMock.loginWithServicePrincipalSecret = function loginWithServicePrincipalSecret(
                aClientId,
                aSecret,
                aTenantId,
                options,
                cb
            ) {
                receivedClientId = aClientId;
                receivedSecret = aSecret;
                receivedTenantId = aTenantId;
                receivedAzureEnvironment = options.environment;
                cb(null, { signRequest() { } });
            };

            callback();
        },

        testAzureLogin(test) {
            const providerOptions = {
                scaleSet: 'myScaleSet',
                resourceGroup: 'myResourceGroup',
                azCredentialsUrl: 'file:///foo/bar'
            };

            provider.init(providerOptions)
                .then(() => {
                    test.strictEqual(receivedClientId, clientId);
                    test.strictEqual(receivedSecret, secret);
                    test.strictEqual(receivedTenantId, tenantId);
                    test.done();
                });
        },

        testAzureGovLogin(test) {
            azureLocation = 'USGovArizona';

            const providerOptions = {
                scaleSet: 'myScaleSet',
                resourceGroup: 'myResourceGroup',
                azCredentialsUrl: 'file:///foo/bar'
            };

            test.expect(4);
            provider.init(providerOptions)
                .then(() => {
                    test.strictEqual(receivedClientId, clientId);
                    test.strictEqual(receivedSecret, secret);
                    test.strictEqual(receivedTenantId, tenantId);
                    test.strictEqual(receivedAzureEnvironment.name, 'AzureUSGovernment');
                    test.done();
                });
        },

        testProviderOptionsAzureGovLogin(test) {
            const providerOptions = {
                scaleSet: 'myScaleSet',
                resourceGroup: 'myResourceGroup',
                azCredentialsUrl: 'file:///foo/bar',
                environment: 'AzureUSGovernment'
            };

            test.expect(4);
            provider.init(providerOptions)
                .then(() => {
                    test.strictEqual(receivedClientId, clientId);
                    test.strictEqual(receivedSecret, secret);
                    test.strictEqual(receivedTenantId, tenantId);
                    test.strictEqual(receivedAzureEnvironment.name, 'AzureUSGovernment');
                    test.done();
                });
        },

        testAzureLoginEncrypted(test) {
            const providerOptions = {
                scaleSet: 'myScaleSet',
                resourceGroup: 'myResourceGroup',
                azCredentialsUrl: 'file:///foo/bar',
                azCredentialsEncrypted: true
            };

            provider.init(providerOptions)
                .then(() => {
                    test.strictEqual(receivedClientId, clientId);
                    test.strictEqual(receivedSecret, secret);
                    test.strictEqual(receivedTenantId, tenantId);
                    test.done();
                });
        },

        testAzureLoginBadCredentialsUrl(test) {
            const errorMessage = 'bad url';
            utilMock.getDataFromUrl = function getDataFromUrl() {
                return q.reject(new Error(errorMessage));
            };

            test.expect(1);
            provider.init({ azCredentialsUrl: 'file:///foo/bar' })
                .then(() => {
                    test.ok(false, 'Should have thrown bad url');
                })
                .catch((err) => {
                    test.strictEqual(err.message, errorMessage);
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testGetInstanceId: {
        setUp(callback) {
            utilMock.getDataFromUrl = function getDataFromUrl() {
                return q({
                    compute: {
                        name: 'instance456'
                    }
                });
            };

            azureComputeMock.virtualMachineScaleSetVMs = {
                list(resourceGroup, scaleSetName, options, cb) {
                    cb(
                        null,
                        [
                            {
                                instanceId: '123',
                                provisioningState: 'Succeeded',
                                name: 'instance123',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            },
                            {
                                instanceId: '456',
                                provisioningState: 'Succeeded',
                                name: 'instance456',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            }
                        ]
                    );
                }
            };

            provider.computeClient = azureComputeMock;
            provider.networkClient = azureNetworkMock;
            provider.scaleSet = 'my scale set';
            provider.resourceGroup = 'my resource group';

            callback();
        },

        testBasic(test) {
            test.expect(1);
            provider.getInstanceId()
                .then((instanceId) => {
                    test.strictEqual(instanceId, '456');
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testCached(test) {
            provider.instanceId = '789';
            test.expect(1);
            provider.getInstanceId()
                .then((instanceId) => {
                    test.strictEqual(instanceId, '789');
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testStatic(test) {
            utilMock.getDataFromUrl = function getDataFromUrl() {
                return q({
                    compute: {
                        name: 'instance888',
                        vmId: '888'
                    }
                });
            };

            provider.clOptions.static = true;

            test.expect(1);
            provider.getInstanceId()
                .then((instanceId) => {
                    test.strictEqual(instanceId, '888');
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testOurNameNotFound(test) {
            utilMock.getDataFromUrl = function getDataFromUrl() {
                return q({
                    compute: {
                        name: 'instance789'
                    }
                });
            };

            test.expect(1);
            provider.getInstanceId()
                .then(() => {
                    test.ok(false, 'should have thrown id not found');
                })
                .catch((err) => {
                    test.notStrictEqual(err.message.indexOf('Unable to determine'), -1);
                })
                .finally(() => {
                    test.done();
                });
        },

        testBadMetaData(test) {
            utilMock.getDataFromUrl = function getDataFromUrl() {
                return q({});
            };

            test.expect(1);
            provider.getInstanceId()
                .then(() => {
                    test.ok(false, 'should have thrown id not found');
                })
                .catch((err) => {
                    test.notStrictEqual(err.message.indexOf('not found in metadata'), -1);
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testDeleteStoredUcs: {
        setUp(callback) {
            provider.storageClient = {
                deleteBlobIfExists: function(c,n, cb) {
                    deleteBlobIfExistsCalled = true;
                    cb(null, 'Success');
                },
                BACKUP_CONTAINER: 'backup'
            };

            callback();
        },
        testExists(test) {
            provider.deleteStoredUcs('foo.ucs')
                .then(() => {
                    test.ok(true);
                    test.ok(deleteBlobIfExistsCalled);
                })
                .catch((err) => {
                    test.ok(false, err.message);
                })
                .finally(() => {
                    deleteBlobIfExistsCalled = false;
                    test.done();
                });
        }
    },

    testGetInstances: {
        setUp(callback) {
            bigIpMock.prototype.init = function init(host) {
                this.host = host;
                return q();
            };

            bigIpMock.prototype.list = function list() {
                return q({
                    hostname: `${this.host}_myHostname`
                });
            };

            azureComputeMock.virtualMachineScaleSetVMs = {
                list(resourceGroup, scaleSetName, options, cb) {
                    cb(
                        null,
                        [
                            {
                                instanceId: '123',
                                provisioningState: 'Succeeded',
                                id: 'instance/123',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            },
                            {
                                instanceId: '456',
                                provisioningState: 'Succeeded',
                                id: 'instance/456',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            }
                        ]
                    );
                }
            };

            azureNetworkMock.networkInterfaces = {
                listVirtualMachineScaleSetNetworkInterfaces(resourceGroup, scaleSet, cb) {
                    cb(null, {
                        123: {
                            virtualMachine: {
                                id: 'instance/123'
                            },
                            ipConfigurations: [
                                {
                                    privateIPAddress: '5.6.7.8',
                                    publicIPAddress: {
                                        id: 'one/two/three/four/five/six/seven/ipName'
                                    }
                                }
                            ]
                        },
                        456: {
                            virtualMachine: {
                                id: 'instance/456'
                            },
                            ipConfigurations: [
                                {
                                    privateIPAddress: '7.8.9.0'
                                }
                            ]
                        }
                    });
                }
            };

            azureNetworkMock.publicIPAddresses = {
                get(resourceGroup, publicIpName, cb) {
                    cb(null, {
                        ipAddress: '123.456.789.1'
                    });
                }
            };

            azureStorageMock.listBlobsSegmented = function listBlobsSegmented(container, token, options, cb) {
                cb(null, { entries: [] });
            };

            provider.computeClient = azureComputeMock;
            provider.networkClient = azureNetworkMock;
            provider.storageClient = azureStorageMock;
            provider.scaleSet = 'my scale set';
            provider.resourceGroup = 'my resource group';

            callback();
        },

        testBasic(test) {
            test.expect(19);
            provider.getInstances()
                .then((instances) => {
                    test.strictEqual(instances['123'].mgmtIp, '5.6.7.8');
                    test.strictEqual(instances['123'].privateIp, '5.6.7.8');
                    test.strictEqual(instances['123'].publicIp, '123.456.789.1');
                    test.strictEqual(instances['123'].hostname, '5.6.7.8_myHostname');
                    test.strictEqual(instances['123'].providerVisible, true);
                    test.strictEqual(instances['123'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['123'].isPrimary, false);
                    test.strictEqual(instances['123'].external, false);
                    test.strictEqual(instances['123'].lastBackup, new Date(1970, 1, 1).getTime());
                    test.strictEqual(instances['123'].versionOk, true);

                    test.strictEqual(instances['456'].mgmtIp, '7.8.9.0');
                    test.strictEqual(instances['456'].privateIp, '7.8.9.0');
                    test.strictEqual(instances['456'].hostname, '7.8.9.0_myHostname');
                    test.strictEqual(instances['456'].providerVisible, true);
                    test.strictEqual(instances['456'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['456'].isPrimary, false);
                    test.strictEqual(instances['456'].external, false);
                    test.strictEqual(instances['456'].lastBackup, new Date(1970, 1, 1).getTime());
                    test.strictEqual(instances['456'].versionOk, true);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testInstancesInDb(test) {
            azureStorageMock.listBlobsSegmented = function listBlobsSegmented(container, token, options, cb) {
                cb(null,
                    {
                        entries: [
                            {
                                name: '123'
                            },
                            {
                                name: '456'
                            }
                        ]
                    });
            };

            azureStorageMock.getBlobToText = function getBlobToText(container, name, cb) {
                let instance;

                switch (name) {
                case '123':
                    instance = {
                        isPrimary: true,
                        mgmtIp: '5.6.7.8',
                        privateIp: '5.6.7.8',
                        publicIp: '123.456.789.1',
                        hostname: '5.6.7.8_myHostname',
                        providerVisible: true,
                        primaryStatus: {}
                    };
                    break;
                case '456':
                    instance = {
                        isPrimary: false,
                        mgmtIp: '7.8.9.0',
                        privateIp: '7.8.9.0',
                        hostname: '7.8.9.0_myHostname',
                        providerVisible: true,
                        primaryStatus: {}
                    };
                    break;
                default:
                    instance = {};
                }
                cb(null, JSON.stringify(instance));
            };

            test.expect(1);
            provider.getInstances()
                .then((instances) => {
                    test.deepEqual(instances, {
                        123: {
                            mgmtIp: '5.6.7.8',
                            privateIp: '5.6.7.8',
                            publicIp: '123.456.789.1',
                            hostname: '5.6.7.8_myHostname',
                            providerVisible: true,
                            isPrimary: true,
                            primaryStatus: {}
                        },
                        456: {
                            mgmtIp: '7.8.9.0',
                            privateIp: '7.8.9.0',
                            hostname: '7.8.9.0_myHostname',
                            providerVisible: true,
                            isPrimary: false,
                            primaryStatus: {}
                        }
                    });
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testNotProviderVisibleProvisioningState(test) {
            azureComputeMock.virtualMachineScaleSetVMs = {
                list(resourceGroup, scaleSetName, options, cb) {
                    cb(
                        null,
                        [
                            {
                                instanceId: '123',
                                provisioningState: 'Failed',
                                id: 'instance/123',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            },
                            {
                                instanceId: '456',
                                provisioningState: 'Succeeded',
                                id: 'instance/456',
                                instanceView: {
                                    instanceId: '456',
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            }
                        ]
                    );
                }
            };

            test.expect(17);
            provider.getInstances()
                .then((instances) => {
                    test.strictEqual(instances['123'].mgmtIp, '5.6.7.8');
                    test.strictEqual(instances['123'].privateIp, '5.6.7.8');
                    test.strictEqual(instances['123'].publicIp, '123.456.789.1');
                    test.strictEqual(instances['123'].hostname, '5.6.7.8_myHostname');
                    test.strictEqual(instances['123'].providerVisible, false);
                    test.strictEqual(instances['123'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['123'].isPrimary, false);
                    test.strictEqual(instances['123'].external, false);
                    test.strictEqual(instances['123'].versionOk, true);

                    test.strictEqual(instances['456'].mgmtIp, '7.8.9.0');
                    test.strictEqual(instances['456'].privateIp, '7.8.9.0');
                    test.strictEqual(instances['456'].hostname, '7.8.9.0_myHostname');
                    test.strictEqual(instances['456'].providerVisible, true);
                    test.strictEqual(instances['456'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['456'].isPrimary, false);
                    test.strictEqual(instances['456'].external, false);
                    test.strictEqual(instances['456'].versionOk, true);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testNotProviderVisiblePowerState(test) {
            azureComputeMock.virtualMachineScaleSetVMs = {
                list(resourceGroup, scaleSetName, options, cb) {
                    cb(
                        null,
                        [
                            {
                                instanceId: '123',
                                provisioningState: 'Succeeded',
                                id: 'instance/123',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            },
                            {
                                instanceId: '456',
                                provisioningState: 'Succeeded',
                                id: 'instance/456',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'powerstate/deallocated',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            }
                        ]
                    );
                }
            };

            test.expect(17);
            provider.getInstances()
                .then((instances) => {
                    test.strictEqual(instances['123'].mgmtIp, '5.6.7.8');
                    test.strictEqual(instances['123'].privateIp, '5.6.7.8');
                    test.strictEqual(instances['123'].publicIp, '123.456.789.1');
                    test.strictEqual(instances['123'].hostname, '5.6.7.8_myHostname');
                    test.strictEqual(instances['123'].providerVisible, true);
                    test.strictEqual(instances['123'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['123'].isPrimary, false);
                    test.strictEqual(instances['123'].external, false);
                    test.strictEqual(instances['123'].versionOk, true);

                    test.strictEqual(instances['456'].mgmtIp, '7.8.9.0');
                    test.strictEqual(instances['456'].privateIp, '7.8.9.0');
                    test.strictEqual(instances['456'].hostname, '7.8.9.0_myHostname');
                    test.strictEqual(instances['456'].providerVisible, false);
                    test.strictEqual(instances['456'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['456'].isPrimary, false);
                    test.strictEqual(instances['456'].external, false);
                    test.strictEqual(instances['456'].versionOk, true);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testNotProviderVisiblePowerStateFunctionError(test) {
            azureComputeMock.virtualMachineScaleSetVMs = {
                list(resourceGroup, scaleSetName, options, cb) {
                    cb(
                        null,
                        [
                            {
                                instanceId: '123',
                                provisioningState: 'Succeeded',
                                id: 'instance/123',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            },
                            {
                                instanceId: '456',
                                provisioningState: 'Succeeded',
                                id: 'instance/456',
                                instanceView: {
                                    statuses: [
                                        {
                                            code: 'ProvisioningState/succeeded',
                                            level: 'Info',
                                            displayStatus: 'Ready',
                                            message: 'Guest Agent is running',
                                            time: '2020-02-03T19:17:07.000Z'
                                        }
                                    ]
                                }
                            }
                        ]
                    );
                }
            };

            test.expect(17);
            provider.getInstances()
                .then((instances) => {
                    test.strictEqual(instances['123'].mgmtIp, '5.6.7.8');
                    test.strictEqual(instances['123'].privateIp, '5.6.7.8');
                    test.strictEqual(instances['123'].publicIp, '123.456.789.1');
                    test.strictEqual(instances['123'].hostname, '5.6.7.8_myHostname');
                    test.strictEqual(instances['123'].providerVisible, true);
                    test.strictEqual(instances['123'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['123'].isPrimary, false);
                    test.strictEqual(instances['123'].external, false);
                    test.strictEqual(instances['123'].versionOk, true);

                    test.strictEqual(instances['456'].mgmtIp, '7.8.9.0');
                    test.strictEqual(instances['456'].privateIp, '7.8.9.0');
                    test.strictEqual(instances['456'].hostname, '7.8.9.0_myHostname');
                    test.strictEqual(instances['456'].providerVisible, true);
                    test.strictEqual(instances['456'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['456'].isPrimary, false);
                    test.strictEqual(instances['456'].external, false);
                    test.strictEqual(instances['456'].versionOk, true);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testExternalTag(test) {
            const externalTag = {
                key: 'foo',
                value: 'bar'
            };

            const interfaceName = 'myInterface';
            const resourceGroupName = 'myResourceGroup';

            azureComputeMock.virtualMachines = {
                list(resourceGroup, cb) {
                    cb(
                        null,
                        [
                            {
                                name: 'vm888',
                                networkProfile: {
                                    networkInterfaces: [
                                        {
                                            // eslint-disable-next-line max-len
                                            id: '/subscriptions/foofoo/resourceGroups/barbar01/providers/Microsoft.Network/networkInterfaces/barbar01-mgmt0',
                                            properties: {
                                                primary: true
                                            }
                                        }
                                    ]
                                },
                                tags: {
                                    foo: externalTag.value
                                }
                            }
                        ]
                    );
                },
            };

            azureComputeMock.virtualMachineScaleSets = {
                list(resourceGroup, cb) {
                    cb(null, []);
                }
            };

            azureNetworkMock.networkInterfaces.get = function get(resourceGroup, nicName, cb) {
                cb(
                    null,
                    {
                        id: `networkInterface1/one/two/three/${resourceGroupName}/five`,
                        name: interfaceName,
                        ipConfigurations: [
                            {
                                primary: true,
                                privateIPAddress: '10.11.12.13'
                            }
                        ]
                    }
                );
            };

            test.expect(17);
            provider.getInstances({ externalTag })
                .then((instances) => {
                    test.strictEqual(instances['123'].mgmtIp, '5.6.7.8');
                    test.strictEqual(instances['123'].privateIp, '5.6.7.8');
                    test.strictEqual(instances['123'].publicIp, '123.456.789.1');
                    test.strictEqual(instances['123'].hostname, '5.6.7.8_myHostname');
                    test.strictEqual(instances['123'].providerVisible, true);
                    test.strictEqual(instances['123'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['123'].isPrimary, false);
                    test.strictEqual(instances['123'].external, false);
                    test.strictEqual(instances['123'].versionOk, true);

                    test.strictEqual(instances['456'].mgmtIp, '7.8.9.0');
                    test.strictEqual(instances['456'].privateIp, '7.8.9.0');
                    test.strictEqual(instances['456'].hostname, '7.8.9.0_myHostname');
                    test.strictEqual(instances['456'].providerVisible, true);
                    test.strictEqual(instances['456'].status, AutoscaleInstance.INSTANCE_STATUS_OK);
                    test.strictEqual(instances['456'].isPrimary, false);
                    test.strictEqual(instances['456'].external, false);
                    test.strictEqual(instances['456'].versionOk, true);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testError(test) {
            const errorMessage = 'some error occurred';
            bigIpMock.prototype.init = function init() {
                return q.reject(new Error(errorMessage));
            };

            test.expect(1);
            provider.getInstances()
                .then(() => {
                    test.ok(false, 'should have thrown');
                })
                .catch((err) => {
                    test.strictEqual(err.message, errorMessage);
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testGetNodesByResourceId: {
        setUp(callback) {
            azureNetworkMock.networkInterfaces = {
                listVirtualMachineScaleSetNetworkInterfaces(resourceGroup, scaleSet, cb) {
                    cb(null, [
                        {
                            id: '/subscriptions/mySubId/resourceGroups/myResourceGroup/providers/Microsoft.Compute/virtualMachineScaleSets/myScaleSetName/virtualMachines/3/networkInterfaces/nic1',
                            virtualMachine: {
                                id: 'instance/123'
                            },
                            ipConfigurations: [
                                {
                                    privateIPAddress: '5.6.7.8',
                                    primary: true
                                }
                            ],
                            primary: true
                        },
                        {
                            virtualMachine: {
                                id: 'instance/456'
                            },
                            ipConfigurations: [
                                {
                                    privateIPAddress: '7.8.9.0'
                                }
                            ]
                        }
                    ]);
                }
            };

            provider.computeClient = azureComputeMock;
            provider.networkClient = azureNetworkMock;
            provider.scaleSet = 'my scale set';
            provider.resourceGroup = 'my resource group';

            callback();
        },

        testBasic(test) {
            test.expect(2);

            provider.getNodesByResourceId('resourceId', 'scaleSet')
                .then((instances) => {
                    test.strictEqual(instances.length, 1);
                    test.strictEqual(instances[0].ip.private, '5.6.7.8');
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testBadResourceType(test) {
            test.expect(1);

            provider.getNodesByResourceId('resourceId', 'resourceType')
                .then(() => {
                    test.ok(false, 'should have thrown');
                })
                .catch((err) => {
                    test.notStrictEqual(err.message.indexOf('supported'), -1);
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testElectPrimary: {
        testBasic(test) {
            const instances = {
                123: {
                    mgmtIp: '5.6.7.8',
                    privateIp: '5.6.7.8',
                    hostname: '5.6.7.8_myHostname',
                    providerVisible: true,
                    versionOk: true
                },
                456: {
                    mgmtIp: '7.8.9.0',
                    privateIp: '7.8.9.0',
                    hostname: '7.8.9.0_myHostname',
                    providerVisible: true,
                    versionOk: true
                }
            };

            test.expect(1);
            provider.electPrimary(instances)
                .then((electedId) => {
                    test.strictEqual(electedId, '123');
                    test.done();
                });
        },

        testLowestNotProviderVisible(test) {
            const instances = {
                123: {
                    mgmtIp: '5.6.7.8',
                    privateIp: '5.6.7.8',
                    hostname: '5.6.7.8_myHostname',
                    providerVisible: false,
                    versionOk: true
                },
                456: {
                    mgmtIp: '7.8.9.0',
                    privateIp: '7.8.9.0',
                    hostname: '7.8.9.0_myHostname',
                    providerVisible: true,
                    versionOk: true
                }
            };

            test.expect(1);
            provider.electPrimary(instances)
                .then((electedId) => {
                    test.strictEqual(electedId, '456');
                    test.done();
                });
        },

        testNoProviderVisible(test) {
            const instances = {
                123: {
                    mgmtIp: '5.6.7.8',
                    privateIp: '5.6.7.8',
                    hostname: '5.6.7.8_myHostname',
                    providerVisible: false,
                    versionOk: true
                },
                456: {
                    mgmtIp: '7.8.9.0',
                    privateIp: '7.8.9.0',
                    hostname: '7.8.9.0_myHostname',
                    providerVisible: false,
                    versionOk: true
                }
            };

            test.expect(1);
            provider.electPrimary(instances)
                .then(() => {
                    test.ok(false, 'should have thrown no instances');
                })
                .catch((err) => {
                    test.strictEqual(err.message, 'No possible primary found');
                })
                .finally(() => {
                    test.done();
                });
        },

        testLowestNotVersionOk(test) {
            const instances = {
                123: {
                    mgmtIp: '5.6.7.8',
                    privateIp: '5.6.7.8',
                    hostname: '5.6.7.8_myHostname',
                    providerVisible: true,
                    versionOk: false
                },
                456: {
                    mgmtIp: '7.8.9.0',
                    privateIp: '7.8.9.0',
                    hostname: '7.8.9.0_myHostname',
                    providerVisible: true,
                    versionOk: true
                }
            };

            test.expect(1);
            provider.electPrimary(instances)
                .then((electedId) => {
                    test.strictEqual(electedId, '456');
                    test.done();
                });
        },

        testExternalInstances(test) {
            const instances = {
                123: {
                    mgmtIp: '5.6.7.8',
                    privateIp: '5.6.7.8',
                    hostname: '5.6.7.8_myHostname',
                    providerVisible: true,
                    versionOk: true
                },
                456: {
                    mgmtIp: '7.8.9.0',
                    privateIp: '7.8.9.0',
                    hostname: '7.8.9.0_myHostname',
                    providerVisible: true,
                    versionOk: true
                },
                999: {
                    mgmtIp: '10.11.12.13',
                    privateIp: '10.11.12.13',
                    hostname: '10.11.12.13_myHostname',
                    providerVisible: true,
                    external: true,
                    versionOk: true
                },
                888: {
                    mgmtIp: '13.14.15.16',
                    privateIp: '13.14.15.16',
                    hostname: '13.14.15.16_myHostname',
                    providerVisible: true,
                    external: true,
                    versionOk: true
                }
            };

            test.expect(1);
            provider.electPrimary(instances)
                .then((electedId) => {
                    test.strictEqual(electedId, '999');
                    test.done();
                });
        },

        testNoInstances(test) {
            const instances = [];

            test.expect(1);
            provider.electPrimary(instances)
                .then(() => {
                    test.ok(false, 'should have thrown no instances');
                })
                .catch((err) => {
                    test.strictEqual(err.message, 'No instances');
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testGetPrimaryCredentials(test) {
        const user = 'roger';
        const password = 'dodger';

        bigIpMock.isInitialized = true;
        bigIpMock.user = user;
        bigIpMock.password = password;
        provider.bigIp = bigIpMock;

        test.expect(1);
        provider.getPrimaryCredentials()
            .then((credentials) => {
                test.deepEqual(credentials, {
                    password,
                    username: user
                });
                test.done();
            });
    },

    testIsValidPrimary: {
        setUp(callback) {
            bigIpMock.init = function init() {
                return q();
            };

            bigIpMock.prototype.list = function list() {
                return q(
                    {
                        hostname: 'foo'
                    }
                );
            };

            bigIpMock.prototype.ready = function ready() {
                return q();
            };

            authnMock.authenticate = function authenticate(host, user, password) {
                icontrolMock.password = password;
                return q.resolve(icontrolMock);
            };
            callback();
        },

        testValid(test) {
            const instanceId = '123';
            const instances = {
                123: {
                    hostname: 'foo',
                    privateIp: '1.2.3.4'
                }
            };

            test.expect(1);
            provider.isValidPrimary(instanceId, instances)
                .then((isValid) => {
                    test.strictEqual(isValid, true);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testNotValid(test) {
            const instanceId = '123';
            const instances = {
                123: {
                    hostname: 'bar',
                    privateIp: '1.2.3.4'
                }
            };

            test.expect(1);
            provider.isValidPrimary(instanceId, instances)
                .then((isValid) => {
                    test.strictEqual(isValid, false);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testTagPrimary: {
        setUp(callback) {
            azureComputeMock.virtualMachineScaleSets = {
                get(resourceGroup, scaleSetName, options, cb) {
                    cb(null,
                        {
                            tags: {
                                application: 'APP',
                                cost: 'COST',
                                'resourceGroupName-primary': '10.0.1.4'
                            }
                        });
                },
                update(resourceGroup, scaleSet, params, options, cb) {
                    virtualMachineScaleSetUpdateParams = {
                        resourceGroup,
                        scaleSet,
                        params,
                        options
                    };
                    cb();
                }
            };

            provider.computeClient = azureComputeMock;
            provider.networkClient = azureNetworkMock;
            provider.scaleSet = 'scaleSetName';
            provider.resourceGroup = 'resourceGroupName';

            callback();
        },

        testTagPrimaryInstance(test) {
            const primaryIid = '456';
            const instances = {
                123: {
                    mgmtIp: '5.6.7.8',
                    privateIp: '5.6.7.8',
                    hostname: '5.6.7.8_myHostname',
                    providerVisible: true,
                    versionOk: true
                },
                456: {
                    mgmtIp: '7.8.9.0',
                    privateIp: '7.8.9.0',
                    hostname: '7.8.9.0_myHostname',
                    providerVisible: true,
                    versionOk: true
                }
            };

            test.expect(3);
            provider.tagPrimaryInstance(primaryIid, instances)
                .then(() => {
                    test.strictEqual(
                        virtualMachineScaleSetUpdateParams.params.tags['resourceGroupName-primary'],
                        instances[primaryIid].privateIp
                    );
                    test.strictEqual(virtualMachineScaleSetUpdateParams.params.tags.application, 'APP');
                    test.strictEqual(virtualMachineScaleSetUpdateParams.resourceGroup, 'resourceGroupName');
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },
    },

    testGetStoredUcs: {
        setUp(callback) {
            provider.storageClient = {
                listBlobsSegmented(container, foo, bar, cb) {
                    cb(null, {
                        entries: ucsEntries
                    });
                },

                createReadStream(container, name) {
                    return { name };
                }
            };

            callback();
        },

        testBasic(test) {
            ucsEntries = [
                {
                    name: 'my.ucs',
                    lastModified: 'Thu, 16 Mar 2017 18:08:54 GMT'
                }
            ];

            provider.getStoredUcs()
                .then((ucsData) => {
                    test.strictEqual(ucsData.name, 'my.ucs');
                    test.done();
                });
        },

        testGetsLatest(test) {
            ucsEntries = [
                {
                    name: 'old.ucs',
                    lastModified: 'Thu, 16 Mar 2017 18:08:54 GMT'
                },
                {
                    name: 'new.ucs',
                    lastModified: 'Thu, 17 Mar 2017 18:08:54 GMT'
                }
            ];

            provider.getStoredUcs()
                .then((ucsData) => {
                    test.strictEqual(ucsData.name, 'new.ucs');
                    test.done();
                });
        },

        testNoUcsFiles(test) {
            ucsEntries = [];
            provider.getStoredUcs()
                .then((ucsData) => {
                    test.strictEqual(ucsData, undefined);
                    test.done();
                });
        },

        testListBlobsSegmentedError(test) {
            const errorMessage = 'foobar';
            provider.storageClient.listBlobsSegmented = function listBlobsSegmented(container, foo, bar, cb) {
                cb(new Error(errorMessage));
            };

            test.expect(1);
            provider.getStoredUcs()
                .then(() => {
                    test.ok(false, 'listBlobsSegmented should have thrown');
                })
                .catch((err) => {
                    test.strictEqual(err.message, errorMessage);
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testPutInstance: {
        setUp(callback) {
            azureStorageMock.createBlockBlobFromText = function createBlockBlobFromText(
                container,
                name,
                data,
                cb
            ) {
                createBlobFromTextParams = {
                    container,
                    name,
                    data
                };
                cb();
            };
            createBlobFromTextParams = undefined;

            provider.storageClient = azureStorageMock;

            callback();
        },

        testBasic(test) {
            const instanceId = '123';
            const instance = {
                foo: 'bar'
            };

            test.expect(3);
            provider.putInstance(instanceId, instance)
                .then(() => {
                    const putData = JSON.parse(createBlobFromTextParams.data);
                    test.strictEqual(createBlobFromTextParams.name, instanceId);
                    test.strictEqual(putData.foo, instance.foo);
                    test.notStrictEqual(putData.lastUpdate, undefined);
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        }
    },

    testGetDataFromUri: {
        setUp(callback) {
            azureStorageMock.getBlobToText = function getBlobToText(container, blob, cb) {
                getBlobToTextParams = {
                    container,
                    blob
                };
                cb(null, 'AzureBlobData');
            };

            provider.storageClient = azureStorageMock;

            getBlobToTextParams = undefined;
            callback();
        },

        testBasic(test) {
            test.expect(3);
            provider.getDataFromUri('https://account.blob.core.windows.net/myStuff/myFile')
                .then((data) => {
                    test.strictEqual(getBlobToTextParams.container, 'myStuff');
                    test.strictEqual(getBlobToTextParams.blob, 'myFile');
                    test.strictEqual(data, 'AzureBlobData');
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testComplexKey(test) {
            test.expect(3);
            provider.getDataFromUri('https://account.blob.core.windows.net/myStuff/myFolder/myFile')
                .then((data) => {
                    test.strictEqual(getBlobToTextParams.container, 'myStuff');
                    test.strictEqual(getBlobToTextParams.blob, 'myFolder/myFile');
                    test.strictEqual(data, 'AzureBlobData');
                })
                .catch((err) => {
                    test.ok(false, err);
                })
                .finally(() => {
                    test.done();
                });
        },

        testInvalidUri(test) {
            test.expect(1);
            provider.getDataFromUri('myStuff/myFolder/myFile')
                .then(() => {
                    test.ok(false, 'Should have thrown invalid URI');
                })
                .catch((err) => {
                    test.notStrictEqual(err.message.indexOf('Invalid URI'), -1);
                })
                .finally(() => {
                    test.done();
                });
        },

        testInvalidBlobPath(test) {
            test.expect(1);
            provider.getDataFromUri('https://account.blob.core.windows.net/myStuff')
                .then(() => {
                    test.ok(false, 'Should have thrown invalid URI');
                })
                .catch((err) => {
                    test.notStrictEqual(err.message.indexOf('Invalid URI'), -1);
                })
                .finally(() => {
                    test.done();
                });
        }
    },
};
