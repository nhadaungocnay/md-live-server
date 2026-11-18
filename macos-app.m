#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface DropWebView : WKWebView
@end

@implementation DropWebView

- (instancetype)initWithFrame:(CGRect)frame configuration:(WKWebViewConfiguration *)configuration {
    self = [super initWithFrame:frame configuration:configuration];
    if (self) {
        [self registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
    }
    return self;
}

- (instancetype)initWithCoder:(NSCoder *)coder {
    self = [super initWithCoder:coder];
    if (self) {
        [self registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
    }
    return self;
}

- (NSArray<NSURL *> *)extractDraggedFileURLs:(id<NSDraggingInfo>)sender {
    NSDictionary *opts = @{ NSPasteboardURLReadingFileURLsOnlyKey: @YES };
    NSArray *items = [sender.draggingPasteboard readObjectsForClasses:@[[NSURL class]] options:opts];
    return items ?: @[];
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    if ([self extractDraggedFileURLs:sender].count > 0) {
        return NSDragOperationCopy;
    }
    return [super draggingEntered:sender];
}

- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
    if ([self extractDraggedFileURLs:sender].count > 0) {
        return NSDragOperationCopy;
    }
    return [super draggingUpdated:sender];
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSArray<NSURL *> *urls = [self extractDraggedFileURLs:sender];
    if (urls.count == 1) {
        NSURL *fileURL = urls.firstObject;
        BOOL isDir = NO;
        if ([[NSFileManager defaultManager] fileExistsAtPath:fileURL.path isDirectory:&isDir]) {
            NSString *ext = fileURL.pathExtension.lowercaseString;
            if (isDir || [ext isEqualToString:@"md"] || [ext isEqualToString:@"markdown"]) {
                NSData *jsonData = [NSJSONSerialization dataWithJSONObject:@[fileURL.path] options:0 error:nil];
                if (jsonData) {
                    NSString *jsonArr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
                    NSString *js = [NSString stringWithFormat:
                        @"document.getElementById('drop-overlay')?.classList.remove('open'); "
                        @"if (window.switchWorkspacePath) { window.switchWorkspacePath((%@)[0]); }",
                        jsonArr];
                    dispatch_async(dispatch_get_main_queue(), ^{
                        [self evaluateJavaScript:js completionHandler:nil];
                    });
                    return YES;
                }
            }
        }
    }
    return [super performDragOperation:sender];
}

@end

@interface AppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) DropWebView *webView;
@property (nonatomic, assign) NSInteger serverPort;
@property (nonatomic, copy) NSString *appRootPath;
@end

@implementation AppDelegate

- (instancetype)init {
    self = [super init];
    if (self) {
        _serverPort = 3456;
        _appRootPath = @"/Volumes/Data/App/MD Live Server";
    }
    return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [self resolvePathsAndPort];
    [self ensureServerStarted];
    [self setupMainMenu];
    [self setupWindow];
    [self loadWhenServerReady:0];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    if (!flag) {
        [self.window makeKeyAndOrderFront:nil];
    }
    [NSApp activateIgnoringOtherApps:YES];
    return YES;
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    [sender orderOut:nil];
    return NO;
}

- (void)resolvePathsAndPort {
    NSString *bundleParent = [[[NSBundle mainBundle].bundlePath stringByDeletingLastPathComponent] copy];
    NSString *candidateServer = [bundleParent stringByAppendingPathComponent:@"md-server.mjs"];
    if ([[NSFileManager defaultManager] fileExistsAtPath:candidateServer]) {
        self.appRootPath = bundleParent;
    }

    NSString *envPath = [self.appRootPath stringByAppendingPathComponent:@".env"];
    NSString *content = [NSString stringWithContentsOfFile:envPath encoding:NSUTF8StringEncoding error:nil];
    if (content) {
        NSCharacterSet *quotes = [NSCharacterSet characterSetWithCharactersInString:@"\"'"];
        for (NSString *rawLine in [content componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]]) {
            NSString *line = [rawLine stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
            if ([line hasPrefix:@"PORT="]) {
                NSString *val = [[[line substringFromIndex:5]
                    stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]]
                    stringByTrimmingCharactersInSet:quotes];
                NSInteger p = val.integerValue;
                if (p > 0) {
                    self.serverPort = p;
                }
                break;
            }
        }
    }
}

- (void)ensureServerStarted {
    NSString *resourcePath = [NSBundle mainBundle].resourcePath;
    if (!resourcePath) return;
    NSString *scriptPath = [resourcePath stringByAppendingPathComponent:@"launch.sh"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:scriptPath]) return;

    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
    task.arguments = @[scriptPath];
    @try {
        [task launch];
        [task waitUntilExit];
    } @catch (NSException *ex) {
        NSLog(@"launch.sh error: %@", ex);
    }
}

- (void)setupWindow {
    NSRect screenFrame = [NSScreen mainScreen] ? [NSScreen mainScreen].visibleFrame : NSMakeRect(0, 0, 1440, 900);
    CGFloat width = MIN(1280.0, screenFrame.size.width * 0.88);
    CGFloat height = MIN(820.0, screenFrame.size.height * 0.88);
    NSRect rect = NSMakeRect(0, 0, width, height);

    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
    self.window = [[NSWindow alloc] initWithContentRect:rect styleMask:style backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"MD Live Server";
    self.window.minSize = NSMakeSize(800, 520);
    [self.window center];
    self.window.delegate = self;

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
    self.webView = [[DropWebView alloc] initWithFrame:rect configuration:config];
    self.webView.UIDelegate = self;
    self.webView.navigationDelegate = self;
    self.webView.allowsBackForwardNavigationGestures = YES;

    self.window.contentView = self.webView;
    [self.window makeKeyAndOrderFront:nil];
}

- (void)loadWhenServerReady:(NSInteger)attempt {
    NSString *checkStr = [NSString stringWithFormat:@"http://localhost:%ld/api/workspace", (long)self.serverPort];
    NSURL *checkURL = [NSURL URLWithString:checkStr];
    if (!checkURL) return;

    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:checkURL];
    req.timeoutInterval = 0.6;

    __weak typeof(self) weakSelf = self;
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) return;

        NSHTTPURLResponse *httpRes = (NSHTTPURLResponse *)response;
        BOOL ok = (httpRes && httpRes.statusCode == 200);
        dispatch_async(dispatch_get_main_queue(), ^{
            if (ok || attempt >= 30) {
                NSString *targetStr = [NSString stringWithFormat:@"http://localhost:%ld/", (long)strongSelf.serverPort];
                NSURL *targetURL = [NSURL URLWithString:targetStr];
                if (targetURL) {
                    [strongSelf.webView loadRequest:[NSURLRequest requestWithURL:targetURL]];
                }
            } else {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(150 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
                    [strongSelf loadWhenServerReady:attempt + 1];
                });
            }
        });
    }] resume];
}

- (void)setupMainMenu {
    NSMenu *mainMenu = [[NSMenu alloc] init];

    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] init];
    [appMenu addItemWithTitle:@"Tải lại trang" action:@selector(reloadPage) keyEquivalent:@"r"];
    [appMenu addItemWithTitle:@"Mở trên trình duyệt ngoài" action:@selector(openInBrowser) keyEquivalent:@"b"];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Ẩn cửa sổ" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItemWithTitle:@"Thoát MD Live Server" action:@selector(terminate:) keyEquivalent:@"q"];
    appMenuItem.submenu = appMenu;

    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:NSSelectorFromString(@"undo:") keyEquivalent:@"z"];
    NSMenuItem *redoItem = [[NSMenuItem alloc] initWithTitle:@"Redo" action:NSSelectorFromString(@"redo:") keyEquivalent:@"z"];
    redoItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [editMenu addItem:redoItem];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    editMenuItem.submenu = editMenu;

    NSApp.mainMenu = mainMenu;
}

- (void)reloadPage {
    [self.webView reload];
}

- (void)openInBrowser {
    NSString *fallback = [NSString stringWithFormat:@"http://localhost:%ld/", (long)self.serverPort];
    NSURL *url = self.webView.URL ?: [NSURL URLWithString:fallback];
    if (url) {
        [[NSWorkspace sharedWorkspace] openURL:url];
    }
}

#pragma mark - WKUIDelegate

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"MD Live Server";
    alert.informativeText = message ?: @"";
    [alert addButtonWithTitle:@"OK"];
    [alert runModal];
    completionHandler();
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"MD Live Server";
    alert.informativeText = message ?: @"";
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Hủy"];
    NSModalResponse resp = [alert runModal];
    completionHandler(resp == NSAlertFirstButtonReturn);
}

- (void)webView:(WKWebView *)webView runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString * _Nullable))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"MD Live Server";
    alert.informativeText = prompt ?: @"";
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Hủy"];
    NSTextField *input = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 300, 24)];
    input.stringValue = defaultText ?: @"";
    alert.accessoryView = input;
    if ([alert runModal] == NSAlertFirstButtonReturn) {
        completionHandler(input.stringValue);
    } else {
        completionHandler(nil);
    }
}

- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)navigationAction windowFeatures:(WKWindowFeatures *)windowFeatures {
    NSURL *url = navigationAction.request.URL;
    if (url) {
        [[NSWorkspace sharedWorkspace] openURL:url];
    }
    return nil;
}

#pragma mark - WKNavigationDelegate

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    NSString *scheme = url.scheme.lowercaseString;
    NSString *host = url.host.lowercaseString;
    if (url && ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) &&
        host && ![host isEqualToString:@"localhost"] && ![host isEqualToString:@"127.0.0.1"]) {
        [[NSWorkspace sharedWorkspace] openURL:url];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
