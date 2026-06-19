use std::mem;

#[no_mangle]
pub extern "C" fn alloc_u8(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

#[no_mangle]
/// # Safety
///
/// `ptr` must have been returned by `alloc_u8` with the same `len`, and it must
/// not be used again after this call.
pub unsafe extern "C" fn dealloc_u8(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

#[no_mangle]
pub extern "C" fn alloc_u32(len: usize) -> *mut u32 {
    let mut buffer = Vec::<u32>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

#[no_mangle]
/// # Safety
///
/// `ptr` must have been returned by `alloc_u32` with the same `len`, and it must
/// not be used again after this call.
pub unsafe extern "C" fn dealloc_u32(ptr: *mut u32, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

#[no_mangle]
/// # Safety
///
/// `input_ptr` must point to `input_len` readable bytes. `output_ptr` must point
/// to `output_capacity` writable `u32` slots. Both memory regions must be valid
/// for the duration of the call.
pub unsafe extern "C" fn scan_newlines(
    input_ptr: *const u8,
    input_len: usize,
    output_ptr: *mut u32,
    output_capacity: usize,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let output = std::slice::from_raw_parts_mut(output_ptr, output_capacity);
    let mut count = 0usize;

    for (index, byte) in input.iter().enumerate() {
        if *byte == b'\n' {
            if count < output_capacity {
                output[count] = index as u32;
            }
            count += 1;
        }
    }

    count
}
