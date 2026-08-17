' 4K design canvas. TVMScene scales uiRoot by min(uiW/3840, uiH/2160).

function tvmDesignW() as Integer
  return 3840
end function

function tvmDesignH() as Integer
  return 2160
end function

function tvmUiMetrics() as Object
  info = CreateObject("roDeviceInfo")
  width = tvmDesignW()
  height = tvmDesignH()
  name = "FHD"
  if info <> invalid
    ui = info.GetUIResolution()
    if ui <> invalid
      if ui.DoesExist("width") and ui.width <> invalid then width = Int(ui.width)
      if ui.DoesExist("height") and ui.height <> invalid then height = Int(ui.height)
      if ui.DoesExist("name") and ui.name <> invalid then name = ui.name
    end if
    if width <= 0 or height <= 0
      size = info.GetDisplaySize()
      if size <> invalid
        if size.DoesExist("w") then width = Int(size.w)
        if size.DoesExist("h") then height = Int(size.h)
      end if
    end if
  end if
  if width <= 0 then width = 1920
  if height <= 0 then height = 1080
  sx = width / tvmDesignW()
  sy = height / tvmDesignH()
  scale = sx
  if sy < scale then scale = sy
  if scale <= 0 then scale = 0.5
  metrics = {}
  metrics.width = width
  metrics.height = height
  metrics.name = name
  metrics.scale = scale
  metrics.x = Int((width - (tvmDesignW() * scale)) / 2)
  metrics.y = Int((height - (tvmDesignH() * scale)) / 2)
  return metrics
end function
