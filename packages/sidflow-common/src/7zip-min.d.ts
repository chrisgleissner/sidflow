/**
 * Type declarations for 7zip-min module
 * This module provides Node.js bindings for 7-Zip archive operations
 */
declare module '7zip-min' {
    /**
     * Pack (compress) a file or directory into a 7z archive
     * @param source - Path to the file or directory to compress
     * @param destination - Path where the .7z archive will be created
     * @param callback - Callback function called when operation completes or fails
     */
    export function pack(
        source: string,
        destination: string,
        callback: (error?: Error | null) => void
    ): void;

    /**
     * Unpack (extract) a 7z archive
     * @param source - Path to the .7z archive to extract
     * @param destination - Directory where contents will be extracted
     * @param callback - Callback function called when operation completes or fails
     */
    export function unpack(
        source: string,
        destination: string,
        callback: (error?: Error | null) => void
    ): void;
}
