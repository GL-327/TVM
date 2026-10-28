#pragma once

// A small test harness shared by every test file. Each TEST registers itself
// at static initialisation; main() runs them all and reports failures.

#include <cmath>
#include <cstdio>
#include <exception>
#include <string>
#include <vector>

namespace tvm::testing {

struct Failure {
    std::string message;
};

struct TestCase {
    const char* name;
    void (*run)();
};

inline std::vector<TestCase>& Registry() {
    static std::vector<TestCase> cases;
    return cases;
}

struct Registration {
    Registration(const char* name, void (*run)()) { Registry().push_back({name, run}); }
};

inline int RunAll() {
    int failures = 0;
    for (const TestCase& test : Registry()) {
        try {
            test.run();
            std::printf("PASS %s\n", test.name);
        } catch (const Failure& failure) {
            ++failures;
            std::printf("FAIL %s: %s\n", test.name, failure.message.c_str());
        } catch (const std::exception& error) {
            ++failures;
            std::printf("FAIL %s: unexpected exception: %s\n", test.name, error.what());
        }
    }
    std::printf("%zu tests, %d failed\n", Registry().size(), failures);
    return failures == 0 ? 0 : 1;
}

}  // namespace tvm::testing

#define TEST(name)                                                  \
    static void name();                                             \
    static const ::tvm::testing::Registration name##_registration(#name, &name); \
    static void name()

#define REQUIRE(condition)                                                                              \
    do {                                                                                                \
        if (!(condition)) {                                                                             \
            throw ::tvm::testing::Failure{std::string(__FILE__) + ":" + std::to_string(__LINE__) + ": " \
                                          #condition};                                                  \
        }                                                                                               \
    } while (false)

#define REQUIRE_EQ(actual, expected)                                                                 \
    do {                                                                                             \
        const auto actualValue = (actual);                                                           \
        const auto expectedValue = (expected);                                                       \
        if (!(actualValue == expectedValue)) {                                                       \
            throw ::tvm::testing::Failure{std::string(__FILE__) + ":" + std::to_string(__LINE__) +   \
                                          ": " #actual " != " #expected};                            \
        }                                                                                            \
    } while (false)

// Floating-point comparison within an absolute tolerance.
#define REQUIRE_NEAR(actual, expected, tolerance)                                                    \
    do {                                                                                             \
        const double actualValue = static_cast<double>(actual);                                      \
        const double expectedValue = static_cast<double>(expected);                                  \
        if (!(std::abs(actualValue - expectedValue) <= (tolerance))) {                               \
            throw ::tvm::testing::Failure{std::string(__FILE__) + ":" + std::to_string(__LINE__) +   \
                                          ": " #actual " = " + std::to_string(actualValue) +         \
                                          ", expected " + std::to_string(expectedValue)};            \
        }                                                                                            \
    } while (false)

#define REQUIRE_THROWS_CONTAINING(expression, text)                                                  \
    do {                                                                                             \
        bool matched = false;                                                                        \
        try {                                                                                        \
            (void)(expression);                                                                      \
        } catch (const std::exception& error) {                                                      \
            matched = std::string(error.what()).find(text) != std::string::npos;                     \
        }                                                                                            \
        if (!matched) {                                                                              \
            throw ::tvm::testing::Failure{std::string(__FILE__) + ":" + std::to_string(__LINE__) +   \
                                          ": expected an exception containing: " text};             \
        }                                                                                            \
    } while (false)
