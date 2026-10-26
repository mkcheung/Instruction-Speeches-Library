<?php

namespace App\Support;

use RuntimeException;

class ScratchFileAllocationException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Unable to allocate a media scratch file.');
    }
}
