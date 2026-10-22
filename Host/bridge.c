#include "BrowserHost.h"
#include <time.h>
double browser_monotonic_seconds(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return 0;
    return (double)value.tv_sec + (double)value.tv_nsec / 1000000000.0;
}
/* Implementations are supplied by the local browser Worker, not a server. */
