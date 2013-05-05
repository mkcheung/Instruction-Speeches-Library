<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("userrole.php");
include_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
if(isset($_POST['roleid'])){
	$role_id = $_POST['roleid'];     
	$result = UserRole::delete_by_id($role_id);

	if($result == null){

		die("Could not delete role. " . mysql_error()) ;
	} else {
		redirect_to('settings.php');
	}
}
?>