import SwiftUI
import WebKit

// DEVICE GATE: See docs/IOS_TESTING.md. macOS compilation, signing and physical
// iPhone media/permission testing remain required; this is not a verified IPA.
@main
struct TVMApp: App {
    var body: some Scene {
        WindowGroup { ConnectionScreen().preferredColorScheme(.dark) }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var address = ""
    @Published var token = ""
    @Published var allowLocalHTTP = false
    @Published var busy = false
    @Published var error: String?
    @Published var active: ActiveConnection?
    private var restored = false

    func restore() async {
        guard !restored else { return }
        restored = true
        guard let saved = CredentialStore.read() else { return }
        address = saved.origin.absoluteString
        token = saved.token
        allowLocalHTTP = saved.allowLocalHTTP
        await connect()
    }

    func connect() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let connection = try Connection.validated(address: address, token: token, allowLocalHTTP: allowLocalHTTP)
            let cookie = try await SessionClient.connect(connection)
            do { try CredentialStore.save(connection) }
            catch {
                await SessionClient.disconnect(connection, cookie: cookie)
                throw error
            }
            active = ActiveConnection(connection: connection, cookie: cookie)
        } catch let problem as ClientError { error = problem.localizedDescription }
        catch {
            error = "Could not reach TVM. Check that Core is running, both devices share Wi-Fi, and Local Network access is allowed in iOS Settings."
        }
    }

    func disconnect() {
        do { try CredentialStore.clear() }
        catch { self.error = error.localizedDescription; return }
        let previous = active
        active = nil
        token = ""
        error = nil
        if let previous {
            Task { await SessionClient.disconnect(previous.connection, cookie: previous.cookie) }
        }
    }
}

struct ActiveConnection: Identifiable {
    let id = UUID()
    let connection: Connection
    let cookie: HTTPCookie
}

struct ConnectionScreen: View {
    @StateObject private var model = AppModel()

    var body: some View {
        Group {
            if let active = model.active {
                PlayerShell(active: active, disconnect: model.disconnect).id(active.id)
            } else {
                NavigationStack {
                    Form {
                        Section {
                            Text("Your TVM, on your phone").font(.title2.bold())
                            Text("Connect to the computer running TVM on your home network.")
                                .foregroundStyle(.secondary)
                        }
                        Section {
                            TextField("http://192.168.1.20:7345", text: $model.address)
                                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .accessibilityLabel("TVM host address")
                            SecureField("LAN token", text: $model.token)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .privacySensitive()
                            Toggle("Allow private LAN HTTP", isOn: $model.allowLocalHTTP)
                        } header: {
                            Text("TVM connection")
                        } footer: {
                            Text("Use the LAN token configured on your TVM computer. HTTP is for trusted private Wi-Fi testing and does not encrypt network traffic.")
                        }
                        if let error = model.error {
                            Section { Text(error).foregroundStyle(.orange).accessibilityLabel("Connection error: \(error)") }
                        }
                        Section {
                            Button { Task { await model.connect() } } label: {
                                HStack {
                                    Text(model.busy ? "Connecting…" : "Connect to TVM")
                                    Spacer()
                                    if model.busy { ProgressView() }
                                }
                            }.disabled(model.busy)
                            if !model.token.isEmpty {
                                Button("Forget saved connection", role: .destructive, action: model.disconnect)
                                    .disabled(model.busy)
                            }
                        }
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .navigationTitle("TVM")
                }
            }
        }.task { await model.restore() }
    }
}

struct PlayerShell: View {
    let active: ActiveConnection
    let disconnect: () -> Void
    @State private var reload = UUID()
    @State private var error: String?
    @State private var loading = true
    @State private var confirmDisconnect = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 20) {
                Text("TVM").font(.headline)
                Spacer()
                if loading { ProgressView().controlSize(.small) }
                Button { error = nil; loading = true; reload = UUID() } label: {
                    Image(systemName: "arrow.clockwise")
                }.accessibilityLabel("Reload TVM")
                Button { confirmDisconnect = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Connection settings")
            }.padding(.horizontal, 18).frame(height: 44).background(.ultraThinMaterial)
            if let error {
                VStack(spacing: 18) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                    Text(error).multilineTextAlignment(.center)
                    Button("Reconnect", action: disconnect).buttonStyle(.borderedProminent)
                }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                TVMWebView(active: active, loading: $loading, error: $error).id(reload)
            }
        }
        .confirmationDialog("TVM connection", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect and forget token", role: .destructive, action: disconnect)
            Button("Cancel", role: .cancel) { }
        } message: {
            Text(active.connection.origin.absoluteString)
        }
    }
}
