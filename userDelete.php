<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("user.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
if(isset($_POST['userid'])){
	$user_id = $_POST['userid'];     
	$result = User::delete_by_id($user_id);

	if($result == null){

		die("Could not delete user. " . mysql_error()) ;
	} else {
		redirect_to('settings.php');
	}
}
?>