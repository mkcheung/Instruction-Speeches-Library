<?php
require_once("Session.php");
require_once("function.php");

$SESS->logout();

redirect_to("index.php");
?>