<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("Manual.php");
include_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
if(isset($_POST['manualid'])){
	$manual_id = $_POST['manualid'];     
	$result = Manual::delete_by_id($manual_id);

	if($result == null){

		die("Could not delete manual. " . mysql_error()) ;
	} else {
		redirect_to('settings.php');
	}
}
?>