var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
// This will be compiled to JS and served by the AXON server
// The require path will be shimmed by AxonElement
var VEILComponent = require('../../src/components/base-components').VEILComponent;
/**
 * Simple test component for AXON loading
 */
var TestComponent = /** @class */ (function (_super) {
    __extends(TestComponent, _super);
    function TestComponent() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this.counter = 0;
        return _this;
    }
    TestComponent.prototype.onMount = function () {
        console.log('[TestComponent] Mounting...');
        // Listen for test events
        this.subscribe('test.ping');
    };
    TestComponent.prototype.onFirstFrame = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                // Add initial state when first frame is processed
                this.addFacet({
                    id: 'test-state',
                    type: 'state',
                    displayName: 'test',
                    content: 'Test component loaded successfully!',
                    attributes: {
                        mounted: true,
                        timestamp: new Date().toISOString()
                    }
                });
                // Set up periodic updates using events
                this.subscribe('test.update');
                this.intervalId = setInterval(function () {
                    // Emit an event that we'll handle in frame context
                    _this.emit({
                        topic: 'test.update',
                        payload: {}
                    });
                }, 5000);
                return [2 /*return*/];
            });
        });
    };
    TestComponent.prototype.handleEvent = function (event) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, _super.prototype.handleEvent.call(this, event)];
                    case 1:
                        _a.sent();
                        if (event.topic === 'test.ping') {
                            console.log('[TestComponent] Received ping!');
                            this.emit({
                                topic: 'test.pong',
                                payload: { message: 'Pong from AXON component!' }
                            });
                        }
                        else if (event.topic === 'test.update') {
                            // Handle periodic updates in frame context
                            this.counter++;
                            this.updateState('test-state', {
                                attributes: {
                                    counter: this.counter,
                                    lastUpdate: new Date().toISOString()
                                }
                            });
                            this.emit({
                                topic: 'test.pong',
                                payload: { count: this.counter }
                            });
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    TestComponent.prototype.onUnmount = function () {
        console.log('[TestComponent] Unmounting...');
        // Clear interval
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        // Emit farewell event (no VEIL operations during unmount)
        this.emit({
            topic: 'test.farewell',
            payload: { message: 'Test component unmounted gracefully' }
        });
    };
    return TestComponent;
}(VEILComponent));
// CommonJS export for AXON loading
module.exports.default = TestComponent;
