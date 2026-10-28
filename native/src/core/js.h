#pragma once

// JavaScript conversions the Node core relied on, reproduced exactly so that
// identifiers, ratings and URLs come out the same in the native app. Each one
// names the JavaScript it stands in for.

#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace tvm::js {

// Number(value) for a JSON value: undefined and null give NaN, booleans give
// 0 or 1, strings parse as a whole number or decimal (an empty string is 0),
// and anything else gives NaN.
double Number(const nlohmann::json* value);

// String(number) for a finite number: the shortest text that reads back as the
// same value, with no trailing ".0".
std::string NumberToString(double value);

// encodeURIComponent: percent-encodes everything except A-Z a-z 0-9 - _ . ! ~ * ' ( )
std::string EncodeUriComponent(const std::string& text);

// String.prototype.trim for the ASCII whitespace used in the catalogue data.
std::string Trim(const std::string& text);

// hue used for title tints: a 31-multiplier hash over the UTF-16 code units of
// the text, modulo 360. Matches title.ts hueFor.
int HueFor(const std::string& text);

}  // namespace tvm::js
