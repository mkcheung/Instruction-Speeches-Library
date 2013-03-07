<?php
require_once("constants.php");
require_once("functions.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
include_once("header.php");

$errors = array();
$required_fields = array('role') ;

if(isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!isset($_POST[$required_field]) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$errors = $_POST[$required_field] . ' is a required field.';
		}
	}

	if(empty($errors)){

		$theRole = mysql_real_escape_string($_POST['role']);

		$newUR = UserRole::newUserRole($theRole);

		if($newUR->save()){
			redirect_to("index.php");
		} else {
			die("Cannot create new user role. " . mysql_error());
		}

	} else {
		foreach($errors as $error){
			echo "<p>$error</p></br>";
		}
	}
}

?>

<div id="registerErrorMessages"></div>

<form id="userRoleInputForm" action="userRoleInput.php" method="post">
	<legend>User Role Registration:</legend>
	<input type="hidden" id="submit2" name="submit"/></br>
	<input id="role" type="text" name="role"/></br> 
	<input id="userRoleSubmit" name="submit" type="submit"/></br>
</form>