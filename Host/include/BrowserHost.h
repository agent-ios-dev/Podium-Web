#include <stdint.h>
__attribute__((import_module("podium_host"), import_name("disk_size"))) uint64_t browser_disk_size(void);
__attribute__((import_module("podium_host"), import_name("disk_read"))) int32_t browser_disk_read(uint64_t offset, void *buffer, int32_t length);
__attribute__((import_module("podium_host"), import_name("disk_write"))) int32_t browser_disk_write(uint64_t offset, const void *buffer, int32_t length);
__attribute__((import_module("podium_host"), import_name("disk_flush"))) int32_t browser_disk_flush(void);
