' TVM Hub helpers that touch the registry or build Core URLs. Needs
' config.brs (registrySection, loadFlag, joinCorePath) and media.brs.

function hubUrl(coreUrl as String, route as String) as String
  return joinCorePath(coreUrl, "/api/hub/v1" + route)
end function

' ---- Registry (section "tvm") ----

function loadHubInstallationId() as String
  section = registrySection()
  if section.Exists("hubInstallationId") then return section.Read("hubInstallationId")
  return ""
end function

function loadHubDeviceSecret() as String
  section = registrySection()
  if section.Exists("hubDeviceSecret") then return section.Read("hubDeviceSecret")
  return ""
end function

function saveHubInstallation(id as String, secret as String) as Boolean
  section = registrySection()
  section.Write("hubInstallationId", id)
  section.Write("hubDeviceSecret", secret)
  return section.Flush()
end function

function clearHubInstallation() as Boolean
  return saveHubInstallation("", "")
end function

' X-TVM-Device value, or "" when this installation is not registered.
function hubDeviceCredential() as String
  id = loadHubInstallationId()
  secret = loadHubDeviceSecret()
  if id = "" or secret = "" then return ""
  return id + "." + secret
end function

function hubFixtureEnabled() as Boolean
  return loadFlag("hubFixture")
end function

' Bundled demo data (a copy of scripts/fixtures/hub-fixture.json).
function hubLoadFixture() as Object
  raw = ReadAsciiFile("pkg:/source/data/hubFixture.json")
  if raw = invalid or raw = "" then return {}
  parsed = ParseJson(raw)
  if parsed = invalid then return {}
  return parsed
end function
