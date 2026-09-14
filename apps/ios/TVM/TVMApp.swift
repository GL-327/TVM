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
    @FocusState private var field: Field?

    private enum Field { case address, token }

    var body: some View {
        Group {
            if let active = model.active {
                PlayerShell(active: active, disconnect: model.disconnect).id(active.id)
            } else {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 22) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Your TVM")
                                    .font(.largeTitle.bold())
                                Text("On your phone. Connect to the computer running TVM on this Wi-Fi.")
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.top, 8)

                            VStack(alignment: .leading, spacing: 14) {
                                labeled("Host address") {
                                    TextField("http://192.168.1.20:7345", text: $model.address)
                                        .keyboardType(.URL)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled()
                                        .textContentType(.URL)
                                        .focused($field, equals: .address)
                                        .submitLabel(.next)
                                        .onSubmit { field = .token }
                                        .accessibilityLabel("TVM host address")
                                }
                                labeled("LAN token") {
                                    SecureField("Paste the host LAN token", text: $model.token)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled()
                                        .focused($field, equals: .token)
                                        .submitLabel(.go)
                                        .onSubmit { Task { await model.connect() } }
                                        .privacySensitive()
                                        .accessibilityLabel("LAN token")
                                }
                                Toggle("Allow private LAN HTTP", isOn: $model.allowLocalHTTP)
                                Text("Use the LAN token from your TVM computer. HTTP is only for trusted private Wi-Fi and does not encrypt traffic.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(16)
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                            if let error = model.error {
                                Text(error)
                                    .foregroundStyle(.orange)
                                    .accessibilityLabel("Connection error: \(error)")
                            }

                            Button { Task { await model.connect() } } label: {
                                HStack {
                                    Text(model.busy ? "Connecting…" : "Connect to TVM")
                                        .fontWeight(.semibold)
                                    if model.busy {
                                        Spacer()
                                        ProgressView()
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 48)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.busy)

                            if !model.token.isEmpty {
                                Button("Forget saved connection", role: .destructive, action: model.disconnect)
                                    .disabled(model.busy)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                        }
                        .padding(20)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .navigationTitle("TVM")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("Done") { field = nil }
                        }
                    }
                }
            }
        }.task { await model.restore() }
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.semibold))
            content()
                .padding(12)
                .frame(minHeight: 44)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
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
        ZStack {
            Color.black.ignoresSafeArea()
            if let error {
                VStack(spacing: 18) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                    Text(error).multilineTextAlignment(.center)
                    Button("Reconnect", action: disconnect).buttonStyle(.borderedProminent)
                }
                .padding(28)
            } else {
                TVMWebView(active: active, loading: $loading, error: $error)
                    .id(reload)
                    .ignoresSafeArea()
            }
        }
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 10) {
                if loading { ProgressView().controlSize(.small).tint(.white) }
                Menu {
                    Button("Reload TVM") { error = nil; loading = true; reload = UUID() }
                    Button("Disconnect and forget token", role: .destructive) { confirmDisconnect = true }
                } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.title2)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.white, .black.opacity(0.45))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Connection settings")
            }
            .padding(.trailing, 8)
        }
        .confirmationDialog("TVM connection", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect and forget token", role: .destructive, action: disconnect)
            Button("Cancel", role: .cancel) { }
        } message: {
            Text(active.connection.origin.absoluteString)
        }
    }
}
